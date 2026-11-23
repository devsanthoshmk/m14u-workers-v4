import type { Config, Context } from '@netlify/edge-functions';

export const UPSTREAM_TIMEOUT_MS = 8000;

export default async (_: Request, context: Context) => {
  const id = context.params?.id;
  const cgeo = context.geo?.country?.code || 'IN';

  if (!id || id.length < 11) {
    return new Response(JSON.stringify({ error: 'Invalid or missing id' }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Edge Functions-native environment lookup
  const raw = typeof Netlify !== 'undefined' ? Netlify.env?.get('rkeys') : undefined;
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Missing environment variable: rkeys' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Split, trim, and remove empty entries
  const keys = raw
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  if (keys.length === 0) {
    return new Response(JSON.stringify({ error: 'No RapidAPI keys configured in rkeys' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  shuffle(keys);

  try {
    const streamData = await fetcher(cgeo, keys, id);
    const data = {
      title: streamData.title,
      author: streamData.channelTitle,
      authorId: streamData.authorId,
      lengthSeconds: streamData.lengthSeconds,
      adaptiveFormats: streamData.adaptiveFormats
        .map(_ => ({
          url: _.url + '&fallback', // Keep the signed upstream URL intact.
          quality: _.qualityLabel, // qualityLabel from RapidAPI maps to quality/resolution
          type: _.mimeType,
          encoding: _.mimeType?.split('codecs="')[1]?.split('"')[0] || '',
          bitrate: _.bitrate?.toString() || '',
          clen: _.contentLength,
          resolution: _.qualityLabel,
        })),
      recommendedVideos: [], // empty array for compatibility
      captions: [], // empty array for compatibility
      liveNow: streamData.isLiveContent,
      hlsUrl: '',
      dashUrl: '',
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    const status = isTimeout ? 504 : 502;
    const message = isTimeout
      ? 'Upstream provider timed out'
      : (error instanceof Error && error.message === 'Exhausted RapidAPI keys'
          ? 'Exhausted RapidAPI keys'
          : 'Failed to retrieve stream data');
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
};

export const config: Config = {
  path: '/api/v1/videos/:id',
};

const host = 'yt-api.p.rapidapi.com';
export type VideoDetails = {
  title: string;
  channelTitle: string;
  authorId: string;
  lengthSeconds: number;
  isLiveContent: boolean;
  adaptiveFormats: {
    mimeType: string;
    url: string;
    bitrate: number;
    contentLength: string;
    qualityLabel: string;
  }[];
};

export const fetcher = (
  cgeo: string,
  keys: string[],
  id: string,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
  lastError?: Error
): Promise<VideoDetails> => {
  const key = keys.shift();
  if (!key) {
    // no more keys → stop recursion
    return Promise.reject(
      lastError?.name === 'TimeoutError'
        ? lastError
        : new Error('Exhausted RapidAPI keys')
    );
  }

  const url = new URL(`https://${host}/dl`);
  url.search = new URLSearchParams({ id, cgeo }).toString();
  return fetch(url, {
    headers: {
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': host,
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(res =>
      // ensure we got a 2xx before parsing
      res.ok
        ? res.json()
        : Promise.reject(new Error(`HTTP ${res.status}`))
    )
    .then(data => {
      if (data && Array.isArray(data.adaptiveFormats) && data.adaptiveFormats.length) {
        return data;
      }
      // missing or empty adaptiveFormats
      throw new Error(data?.message || 'Missing adaptiveFormats');
    })
    .catch((err: unknown) =>
      // on any failure, try the next key
      fetcher(cgeo, keys, id, timeoutMs, err instanceof Error ? err : new Error(String(err)))
    );
};

export function shuffle(array: string[]) {
  let currentIndex = array.length;

  while (currentIndex != 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}
