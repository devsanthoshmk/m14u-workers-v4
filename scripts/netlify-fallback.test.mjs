import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, ws: false },
});
after(() => server.close());

const { default: handler, fetcher, UPSTREAM_TIMEOUT_MS } = await server.ssrLoadModule('/netlify/edge-functions/fallback.ts');

const createContext = (id, countryCode = 'IN') => ({
  params: id !== undefined ? { id } : {},
  geo: { country: { code: countryCode } },
});

beforeEach(t => {
  globalThis.Netlify = {
    env: {
      get: () => undefined,
    },
  };
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected outbound fetch');
  });
});

test('validation: invalid or missing video id returns 400', async () => {
  const req = new Request('https://example.test/api/v1/videos/short');
  const shortRes = await handler(req, createContext('short'));
  assert.equal(shortRes.status, 400);
  assert.equal(shortRes.headers.get('content-type'), 'application/json');
  assert.equal(shortRes.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await shortRes.json(), { error: 'Invalid or missing id' });

  const missingRes = await handler(req, createContext(''));
  assert.equal(missingRes.status, 400);
  assert.deepEqual(await missingRes.json(), { error: 'Invalid or missing id' });

  const noParamsRes = await handler(req, { params: {}, geo: {} });
  assert.equal(noParamsRes.status, 400);
  assert.deepEqual(await noParamsRes.json(), { error: 'Invalid or missing id' });
});

test('missing config: undefined rkeys returns 500 without throwing', async () => {
  globalThis.Netlify.env.get = () => undefined;
  const req = new Request('https://example.test/api/v1/videos/dQw4w9WgXcQ');
  const res = await handler(req, createContext('dQw4w9WgXcQ'));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'Missing environment variable: rkeys' });
});

test('missing config: empty or whitespace rkeys returns 500 without throwing', async () => {
  globalThis.Netlify.env.get = () => '   , ,   ';
  const req = new Request('https://example.test/api/v1/videos/dQw4w9WgXcQ');
  const res = await handler(req, createContext('dQw4w9WgXcQ'));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'No RapidAPI keys configured in rkeys' });
});

test('successful stream resolution maps formats and preserves &fallback', async (t) => {
  globalThis.Netlify.env.get = () => 'mock-rapidapi-key';
  const mockPayload = {
    title: 'Never Gonna Give You Up',
    channelTitle: 'Rick Astley',
    authorId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    lengthSeconds: 213,
    isLiveContent: false,
    adaptiveFormats: [
      {
        url: 'https://rr1---sn-mock.googlevideo.com/videoplayback?expire=123',
        qualityLabel: 'medium',
        mimeType: 'audio/webm; codecs="opus"',
        bitrate: 131072,
        contentLength: '3456789',
      },
    ],
  };

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.searchParams.get('id'), 'dQw4w9WgXcQ');
    assert.equal(url.searchParams.get('cgeo'), 'US');
    assert.equal(options.headers['X-RapidAPI-Key'], 'mock-rapidapi-key');
    assert.ok(options.signal instanceof AbortSignal, 'Expected AbortSignal to be attached');
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const req = new Request('https://example.test/api/v1/videos/dQw4w9WgXcQ');
  const res = await handler(req, createContext('dQw4w9WgXcQ', 'US'));

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 's-maxage=86400, stale-while-revalidate=3600');

  const body = await res.json();
  assert.equal(body.title, 'Never Gonna Give You Up');
  assert.equal(body.author, 'Rick Astley');
  assert.equal(body.authorId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(body.lengthSeconds, 213);
  assert.equal(body.liveNow, false);
  assert.equal(body.hlsUrl, '');
  assert.equal(body.dashUrl, '');
  assert.deepEqual(body.recommendedVideos, []);
  assert.deepEqual(body.captions, []);
  assert.equal(body.adaptiveFormats.length, 1);
  assert.equal(body.adaptiveFormats[0].url, 'https://rr1---sn-mock.googlevideo.com/videoplayback?expire=123&fallback');
  assert.equal(body.adaptiveFormats[0].quality, 'medium');
  assert.equal(body.adaptiveFormats[0].resolution, 'medium');
  assert.equal(body.adaptiveFormats[0].type, 'audio/webm; codecs="opus"');
  assert.equal(body.adaptiveFormats[0].encoding, 'opus');
  assert.equal(body.adaptiveFormats[0].bitrate, '131072');
  assert.equal(body.adaptiveFormats[0].clen, '3456789');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('upstream timeout: signal aborts hanging request and rotates to next key', async (t) => {
  const calledKeys = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const key = options.headers['X-RapidAPI-Key'];
    calledKeys.push(key);
    assert.ok(options.signal instanceof AbortSignal, 'Expected AbortSignal');
    if (key === 'timed-out-key') {
      return new Promise((_, reject) => {
        if (options.signal.aborted) {
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        } else {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
          });
        }
      });
    }
    return new Response(JSON.stringify({
      title: 'Success on fallback key',
      channelTitle: 'Artist',
      authorId: 'id-1',
      lengthSeconds: 120,
      isLiveContent: false,
      adaptiveFormats: [{
        url: 'https://mock.stream',
        qualityLabel: 'audio',
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 128000,
        contentLength: '1000',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const streamData = await fetcher('IN', ['timed-out-key', 'working-key'], 'dQw4w9WgXcQ', 20);
  assert.equal(streamData.title, 'Success on fallback key');
  assert.deepEqual(calledKeys, ['timed-out-key', 'working-key']);
});

test('unhandled failure: handles exhausted keys with 502 Bad Gateway without crashing', async (t) => {
  globalThis.Netlify.env.get = () => 'bad-key-1, bad-key-2';
  t.mock.method(globalThis, 'fetch', async () => {
    return new Response(JSON.stringify({ message: 'Quota exceeded' }), { status: 429 });
  });

  const req = new Request('https://example.test/api/v1/videos/dQw4w9WgXcQ');
  const res = await handler(req, createContext('dQw4w9WgXcQ'));

  assert.equal(res.status, 502);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'Exhausted RapidAPI keys' });
});

test('upstream timeout on all keys returns 504 Gateway Timeout without crashing', async (t) => {
  globalThis.Netlify.env.get = () => 'timeout-key-1';
  t.mock.method(AbortSignal, 'timeout', () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 10);
    return controller.signal;
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    return new Promise((_, reject) => {
      if (options.signal.aborted) {
        reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      } else {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        });
      }
    });
  });

  const req = new Request('https://example.test/api/v1/videos/dQw4w9WgXcQ');
  const res = await handler(req, createContext('dQw4w9WgXcQ'));

  assert.equal(res.status, 504);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'Upstream provider timed out' });
});

test('default timeout constant is defined as 8000ms', () => {
  assert.equal(UPSTREAM_TIMEOUT_MS, 8000);
});
