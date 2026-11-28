import { Innertube, Log, Platform, Player } from 'youtubei.js/web';
import { anyAbortSignal } from './abortSignal.ts';

type BasicVideoInfo = Awaited<ReturnType<Innertube['getBasicInfo']>>;
type ResolvedStreams = {
  title: string;
  adaptiveFormats: Array<{ url: string; type: string; bitrate: string; encoding: string }>;
};

// Upstream diagnostics may contain unsigned or signed media URL components.
Log.setLevel(Log.Level.NONE);

const CACHE_TTL = 30 * 60 * 1000;
const VISIONOS_UA = 'com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; US)';
const VISIONOS_CLIENT = {
  clientName: 'VISIONOS',
  clientVersion: '1.04',
  clientScreen: 'WATCH',
  platform: 'MOBILE',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.6.0.23O770',
  hl: 'en',
  gl: 'US',
};

const playerCache = new WeakMap<typeof fetch, { promise: Promise<Player>; expiresAt: number }>();
const visitorCache = new WeakMap<typeof fetch, { promise: Promise<string>; expiresAt: number }>();

// youtubei.js/web has no built-in evaluator. Set once at the runtime entry point;
// in particular, a headless isolate does not need the foreground WASM evaluator.
export function configureYouTubeEvaluator(evaluate: typeof Platform.shim.eval) {
  Platform.shim.eval = evaluate;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function normalizeStream(rawUrl: string, mimeType: string, bitrate: number) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !url.hostname.endsWith('.googlevideo.com') || url.searchParams.get('sabr') === '1' ||
      url.searchParams.get('n')?.startsWith('enhanced_except_')) {
    return null;
  }
  const codec = /\bcodecs="([^" ,]+)/i.exec(mimeType)?.[1] ?? '';
  return {
    url: url.href,
    type: mimeType,
    bitrate: String(bitrate),
    encoding: codec.startsWith('mp4a.') ? 'aac' : codec,
  };
}

function getVisitorData(baseFetch: typeof fetch): Promise<string> {
  const now = Date.now();
  const cached = visitorCache.get(baseFetch);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = (async () => {
    const response = await baseFetch('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'content-type': 'application/json',
        'user-agent': VISIONOS_UA,
        'x-goog-api-format-version': '2',
      },
      body: JSON.stringify({ context: { client: VISIONOS_CLIENT } }),
    });
    if (!response.ok) throw new Error(`Visitor ID request failed (${response.status})`);
    const json = await response.json() as { responseContext?: { visitorData?: string } };
    const visitorData = json.responseContext?.visitorData;
    if (!visitorData) throw new Error('Missing visitorData');
    return visitorData;
  })().catch((error) => {
    if (visitorCache.get(baseFetch)?.promise === promise) visitorCache.delete(baseFetch);
    throw error;
  });
  visitorCache.set(baseFetch, { promise, expiresAt: now + CACHE_TTL });
  return promise;
}

async function resolveWithVisionOS(
  videoId: string,
  baseFetch: typeof fetch,
  signal?: AbortSignal,
): Promise<ResolvedStreams | null> {
  const visitorPromise = getVisitorData(baseFetch);
  const visitorData = await abortable(visitorPromise, signal);
  signal?.throwIfAborted();
  const evictVisitor = () => {
    if (visitorCache.get(baseFetch)?.promise === visitorPromise) {
      visitorCache.delete(baseFetch);
    }
  };
  try {
    const response = await baseFetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      credentials: 'omit',
      signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': VISIONOS_UA,
        'x-goog-api-format-version': '2',
        'x-youtube-client-name': '101',
        'x-youtube-client-version': '1.04',
        'x-goog-visitor-id': visitorData,
      },
      body: JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: { client: { ...VISIONOS_CLIENT, visitorData } },
      }),
    });
    signal?.throwIfAborted();
    if (!response.ok) {
      evictVisitor();
      return null;
    }
    const payload = await response.json() as {
      playabilityStatus?: { status?: string };
      videoDetails?: { title?: string };
      streamingData?: {
        adaptiveFormats?: Array<{ url?: string; mimeType?: string; bitrate?: number }>;
      };
    };
    if (payload.playabilityStatus?.status && payload.playabilityStatus.status !== 'OK') {
      evictVisitor();
      return null;
    }
    const adaptiveFormats: ResolvedStreams['adaptiveFormats'] = [];
    for (const format of payload.streamingData?.adaptiveFormats ?? []) {
      if (!format.url || !format.mimeType?.startsWith('audio/') || !Number.isFinite(format.bitrate)) continue;
      try {
        const normalized = normalizeStream(format.url, format.mimeType, format.bitrate!);
        if (normalized) adaptiveFormats.push(normalized);
      } catch { /* A broken format must not hide the other formats. */ }
    }
    return adaptiveFormats.length > 0 ? { title: payload.videoDetails?.title ?? '', adaptiveFormats } : null;
  } catch (error) {
    if (!signal?.aborted) evictVisitor();
    throw error;
  }
}

function getPlayer(baseFetch: typeof fetch): Promise<Player> {
  const now = Date.now();
  const cached = playerCache.get(baseFetch);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = Player.create(undefined, (input, init) =>
    baseFetch(input, { ...init, credentials: 'omit' }),
  ).catch((error) => {
    if (playerCache.get(baseFetch)?.promise === promise) playerCache.delete(baseFetch);
    throw error;
  });
  playerCache.set(baseFetch, { promise, expiresAt: now + CACHE_TTL });
  return promise;
}

async function extractAudioFormats(info: BasicVideoInfo, player: Player | undefined, signal?: AbortSignal) {
  const adaptiveFormats: ResolvedStreams['adaptiveFormats'] = [];
  for (const format of info.streaming_data?.adaptive_formats ?? []) {
    signal?.throwIfAborted();
    if (!format.mime_type?.startsWith('audio/') || !Number.isFinite(format.bitrate)) continue;
    try {
      const normalized = normalizeStream(await format.decipher(player), format.mime_type, format.bitrate);
      if (normalized) adaptiveFormats.push(normalized);
    } catch { /* A broken format must not hide the other formats. */ }
  }
  return adaptiveFormats;
}

export async function resolveYouTubeStreams(
  videoId: string,
  options: { fetch: typeof fetch; signal?: AbortSignal },
): Promise<ResolvedStreams> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new TypeError('Invalid YouTube video ID');
  const { signal } = options;
  signal?.throwIfAborted();

  try {
    const direct = await resolveWithVisionOS(videoId, options.fetch, signal);
    if (direct) return direct;
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const request: typeof fetch = async (input, init) => {
    signal?.throwIfAborted();
    const request = new Request(input, init);
    const combined = signal ? anyAbortSignal([signal, request.signal]) : undefined;
    const requestSignal = combined ? combined.signal : request.signal;
    try {
      const response = await options.fetch(input, { ...init, signal: requestSignal, credentials: 'omit' });
      requestSignal.throwIfAborted();
      return response;
    } finally {
      combined?.cleanup();
    }
  };
  const yt = await Innertube.create({
    fetch: request, generate_session_locally: true, retrieve_innertube_config: false, retrieve_player: false,
  });
  const player = await abortable(getPlayer(options.fetch), signal);
  signal?.throwIfAborted();
  yt.session.player = player;

  for (const client of ['TV', 'TV_EMBEDDED', 'MWEB'] as const) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const adaptiveFormats = await extractAudioFormats(info, player, signal);
      if (adaptiveFormats.length > 0) {
        return { title: info.basic_info.title ?? '', adaptiveFormats };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error('YouTube returned no playable audio formats');
}
