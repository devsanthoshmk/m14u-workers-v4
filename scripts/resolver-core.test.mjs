import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CapacitorHttp } from '@capacitor/core';
import { anyAbortSignal, timeoutAbortSignal } from '../src/lib/modules/resolver/abortSignal.ts';
import { createCapacitorFetch, evaluatePlayerScript } from '../src/lib/modules/resolver/capacitorTransport.ts';
import { resolveYouTubeStreams } from '../src/lib/modules/resolver/core.ts';

const url = 'https://www.youtube.com/fixture';
function mockBridge(t, request) {
  const bridge = t.mock.fn(request);
  return { bridge, capacitorFetch: createCapacitorFetch(bridge) };
}

test('foreground player evaluation transforms parameters without exposing host APIs', async () => {
  const result = await evaluatePlayerScript({
    output: 'const exportedVars = { sigFunction: s => s.split("").reverse().join(""), nFunction: n => `${typeof fetch}:${typeof Capacitor}:${n}` };',
    exported: ['sigFunction', 'nFunction'],
  }, { sig: 'abc', n: 'fixture' });
  assert.deepEqual(result, { sig: 'cba', n: 'undefined:undefined:fixture' });
});

test('bridge Request and header normalization, raw JSON body and non-2xx JSON', async t => {
  const { capacitorFetch } = mockBridge(t, async args => {
    assert.equal(args.url, url);
    assert.equal(args.method, 'POST');
    assert.equal(args.data, '{"hello":42}');
    assert.deepEqual(args.headers, { 'content-type': 'application/json', accept: 'application/json' });
    return { status: 403, url, data: { denied: true }, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'secret' } };
  });
  const result = await capacitorFetch(new Request(url, {
    method: 'POST', headers: new Headers([['Content-Type', 'application/json'], ['Accept', 'application/json'], ['Authorization', 'secret']]),
    body: '{"hello":42}',
  }));
  assert.ok(result instanceof Response);
  assert.equal(result.status, 403);
  assert.equal(result.ok, false);
  assert.equal(result.url, url);
  assert.equal(result.headers.has('set-cookie'), false);
  assert.deepEqual(await result.json(), { denied: true });
});

test('bridge redirects are explicit and validated; player JavaScript remains text', async t => {
  const { bridge, capacitorFetch } = mockBridge(t, async args => {
    assert.equal(args.disableRedirects, true);
    if (args.url === url) return { status: 302, url, data: '', headers: { Location: '/next' } };
    return { status: 200, url: args.url, data: 'const player = 1;\n', headers: { 'Content-Type': 'text/javascript' } };
  });
  const response = await capacitorFetch(new URL(url), { headers: [['Accept', '*/*'], ['User-Agent', 'M14UTest/1.0']] });
  assert.equal(response.url, 'https://www.youtube.com/next');
  assert.equal(response.redirected, true);
  assert.equal(await response.text(), 'const player = 1;\n');
  assert.deepEqual(bridge.mock.calls[0].arguments[0].headers, { accept: '*/*', 'user-agent': 'M14UTest/1.0' });
  assert.equal((await capacitorFetch(url, { redirect: 'manual' })).status, 302);
  await assert.rejects(capacitorFetch(url, { redirect: 'error' }), /redirect rejected/);
  await assert.rejects(capacitorFetch('http://www.youtube.com/fixture'), /Disallowed/);
  assert.equal(bridge.mock.callCount(), 4);
  bridge.mock.mockImplementation(async () => ({ status: 307, url, data: '', headers: { Location: 'http://www.youtube.com/next' } }));
  await assert.rejects(capacitorFetch(url), /Disallowed/);
});

test('bridge drops late responses after abort and rejects oversized bodies', async t => {
  let finish;
  const { bridge, capacitorFetch } = mockBridge(t, () => new Promise(resolve => { finish = resolve; }));
  const stop = new AbortController();
  const request = capacitorFetch(url, { signal: stop.signal });
  await Promise.resolve();
  stop.abort();
  await assert.rejects(request, { name: 'AbortError' });
  finish({ status: 200, url, data: 'late', headers: {} });
  await assert.rejects(capacitorFetch(url, { signal: stop.signal }), { name: 'AbortError' });
  assert.equal(bridge.mock.callCount(), 1);
  bridge.mock.mockImplementation(async args => {
    assert.equal(args.dataType, 'file');
    assert.equal(args.data, 'AP8=');
    return { status: 200, url, data: 'x'.repeat(4 * 1024 * 1024 + 1), headers: {} };
  });
  await assert.rejects(capacitorFetch(url, { method: 'POST', body: new Uint8Array([0, 255]) }), /exceeds size limit/);
});

test('core uses injected unauthenticated fetch, fast-paths VISIONOS, caches visitorData, and filters unsafe formats', async () => {
  const seen = [];
  const fixtureFetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    assert.equal(init?.credentials, 'omit');
    const path = new URL(url).pathname;
    seen.push(path);
    if (path === '/youtubei/v1/visitor_id') {
      return Response.json({ responseContext: { visitorData: 'fixture-visitor' } });
    }
    assert.equal(path, '/youtubei/v1/player');
    const payload = JSON.parse(String(init?.body ?? '{}'));
    assert.equal(payload.videoId, 'pIWaVJPl0-c');
    assert.equal(payload.context.client.clientName, 'VISIONOS');
    assert.equal(payload.context.client.visitorData, 'fixture-visitor');
    return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Fixture' }, streamingData: {
      adaptiveFormats: [
        { url: 'https://r1.googlevideo.com/videoplayback?itag=140', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131000 },
        { url: 'https://r1.googlevideo.com/videoplayback?itag=251&sabr=1', mimeType: 'audio/webm; codecs="opus"', bitrate: 1000 },
        { url: 'http://r1.googlevideo.com/unsafe', mimeType: 'audio/webm', bitrate: 1000 },
        { url: 'https://r1.googlevideo.com/video', mimeType: 'video/webm', bitrate: 2000 },
        { url: 'https://invalid.example/audio', mimeType: 'audio/webm', bitrate: 1000 },
      ],
    } });
  };
  const expected = {
    title: 'Fixture', adaptiveFormats: [{ url: 'https://r1.googlevideo.com/videoplayback?itag=140',
      type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: '131000', encoding: 'aac' }],
  };
  assert.deepEqual(await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fixtureFetch }), expected);
  assert.deepEqual(seen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player']);
  seen.length = 0;
  assert.deepEqual(await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fixtureFetch }), expected);
  assert.deepEqual(seen, ['/youtubei/v1/player']);
  await assert.rejects(resolveYouTubeStreams('invalid', { fetch: fixtureFetch }), /Invalid YouTube video ID/);
  await assert.rejects(resolveYouTubeStreams('pIWaVJPl0-c', {
    fetch: fixtureFetch, signal: AbortSignal.abort(),
  }), { name: 'AbortError' });
  assert.deepEqual(seen, ['/youtubei/v1/player']);
});

test('core falls back to cached player + TV client when VISIONOS returns no playable formats', async () => {
  const seen = [];
  const fallbackFetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    seen.push(path);
    if (path === '/youtubei/v1/visitor_id') return Response.json({ responseContext: { visitorData: 'v1' } });
    if (path === '/iframe_api') return new Response(String.raw`player\/fixture\/`);
    if (path.endsWith('/base.js')) return new Response('(function(a){var x=1;} )({});');
    assert.equal(path, '/youtubei/v1/player');
    const payload = await request.json();
    if (payload.context.client.clientName === 'VISIONOS') {
      return Response.json({ playabilityStatus: { status: 'UNPLAYABLE' } });
    }
    assert.equal(payload.context.client.clientName, 'TVHTML5');
    return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'TV Fallback' }, streamingData: {
      adaptiveFormats: [
        { url: 'https://r1.googlevideo.com/videoplayback?itag=251', mimeType: 'audio/webm; codecs="opus"', bitrate: 128000 },
      ],
    } });
  };
  const expected = {
    title: 'TV Fallback',
    adaptiveFormats: [{ url: 'https://r1.googlevideo.com/videoplayback?itag=251',
      type: 'audio/webm; codecs="opus"', bitrate: '128000', encoding: 'opus' }],
  };
  assert.deepEqual(await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fallbackFetch }), expected);
  assert.deepEqual(seen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player', '/iframe_api', '/s/player/fixture/player_ias.vflset/en_US/base.js', '/youtubei/v1/player']);
  seen.length = 0;
  assert.deepEqual(await resolveYouTubeStreams('dQw4w9WgXcQ', { fetch: fallbackFetch }), expected);
  // VISIONOS rejection evicts visitorData (re-fetched), while Player stays cached (no /iframe_api or /base.js).
  assert.deepEqual(seen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player', '/youtubei/v1/player']);
});

test('core evicts cached visitorData when /player rejects it and preserves it on caller abort', async () => {
  let visitorSeq = 0;
  let mode = 'reject-player';
  const seen = [];
  const fetchMock = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    seen.push(path);
    if (path === '/youtubei/v1/visitor_id') {
      visitorSeq++;
      return Response.json({ responseContext: { visitorData: `visitor-${visitorSeq}` } });
    }
    if (path === '/iframe_api') return new Response(String.raw`player\/fixture\/`);
    if (path.endsWith('/base.js')) return new Response('(function(a){var x=1;} )({});');
    assert.equal(path, '/youtubei/v1/player');
    const payload = await request.json();
    if (payload.context.client.clientName === 'VISIONOS') {
      if (mode === 'reject-player') {
        assert.equal(payload.context.client.visitorData, 'visitor-1');
        return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
      }
      if (mode === 'abort-player') {
        throw new DOMException('Aborted', 'AbortError');
      }
      assert.equal(payload.context.client.visitorData, 'visitor-2');
      return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: { title: 'Recovered' },
        streamingData: {
          adaptiveFormats: [
            { url: 'https://r1.googlevideo.com/videoplayback?itag=140', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000 },
          ],
        },
      });
    }
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'TV Fallback' },
      streamingData: {
        adaptiveFormats: [
          { url: 'https://r1.googlevideo.com/videoplayback?itag=251', mimeType: 'audio/webm; codecs="opus"', bitrate: 128000 },
        ],
      },
    });
  };

  // Rejected player response on visitor-1 must evict visitor-1 so the next call fetches visitor-2.
  await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fetchMock });
  mode = 'ok';
  seen.length = 0;
  const recovered = await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fetchMock });
  assert.equal(recovered.title, 'Recovered');
  assert.deepEqual(seen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player']);
  assert.equal(visitorSeq, 2);

  // Caller abort during /player must NOT evict visitor-2.
  mode = 'abort-player';
  const caller = new AbortController();
  caller.abort();
  await assert.rejects(resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fetchMock, signal: caller.signal }), { name: 'AbortError' });
  mode = 'ok';
  seen.length = 0;
  await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: fetchMock });
  assert.deepEqual(seen, ['/youtubei/v1/player']);
  assert.equal(visitorSeq, 2);
});

test('anyAbortSignal and timeoutAbortSignal work without AbortSignal.any / AbortSignal.timeout', async () => {
  const originalAny = AbortSignal.any;
  const originalTimeout = AbortSignal.timeout;
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  try {
    const a = new AbortController();
    const b = new AbortController();
    const combined = anyAbortSignal([a.signal, b.signal]);
    assert.equal(combined.signal.aborted, false);
    b.abort(new Error('second aborted'));
    assert.equal(combined.signal.aborted, true);
    assert.match(String(combined.signal.reason), /second aborted/);
    combined.cleanup();

    const preAborted = new AbortController();
    preAborted.abort(new Error('already aborted'));
    const immediate = anyAbortSignal([new AbortController().signal, preAborted.signal]);
    assert.equal(immediate.signal.aborted, true);
    assert.match(String(immediate.signal.reason), /already aborted/);
    immediate.cleanup();

    const t = timeoutAbortSignal(15);
    assert.equal(t.signal.aborted, false);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(t.signal.aborted, true);
    assert.equal(t.signal.reason?.name, 'TimeoutError');
    t.cleanup();
  } finally {
    Object.defineProperty(AbortSignal, 'any', { value: originalAny, configurable: true });
    Object.defineProperty(AbortSignal, 'timeout', { value: originalTimeout, configurable: true });
  }
});

test('getStreamData computes expiry across playable audio only and skips native fallbacks on prefetch', async t => {
  const prevAudio = globalThis.Audio;
  const prevDocument = globalThis.document;
  const prevStorage = globalThis.localStorage;
  if (!globalThis.Audio) {
    globalThis.Audio = class extends EventTarget {
      src = '';
      currentTime = 0;
      paused = true;
      played = { length: 0 };
      getAttribute() { return this.src || null; }
      removeAttribute() { this.src = ''; }
      load() { this.played = { length: 0 }; }
      pause() { this.paused = true; }
      async play() { this.paused = false; }
    };
  }
  if (!globalThis.document) globalThis.document = { activeElement: null };
  if (!globalThis.localStorage) {
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  t.after(() => {
    globalThis.Audio = prevAudio;
    globalThis.document = prevDocument;
    globalThis.localStorage = prevStorage;
  });

  let streamExtractorCalls = 0;
  let fetchCalls = 0;
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null, ws: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    plugins: [{
      name: 'stub-native-stream-deps',
      enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/src/lib/utils/platform')) return '\0stub-platform';
        if (source.endsWith('/src/plugins/StreamExtractor')) return '\0stub-extractor';
        if (source === './resolver/core' || source.endsWith('/src/lib/modules/resolver/core')) return '\0stub-core';
      },
      load(id) {
        if (id === '\0stub-platform') return 'export const isNative = () => true; export const isAndroid = () => true;';
        if (id === '\0stub-extractor') {
          return `export default { getStreamData: (...args) => globalThis.__testStreamExtractor(...args) };`;
        }
        if (id === '\0stub-core') {
          return 'export const configureYouTubeEvaluator = () => {}; export const resolveYouTubeStreams = async () => { throw new Error("Simulated JS failure"); };';
        }
      },
    }],
  });
  t.after(() => server.close());

  globalThis.__testStreamExtractor = async () => {
    streamExtractorCalls++;
    return {
      title: 'NewPipe Fallback',
      adaptiveFormats: [{ url: 'https://r1.googlevideo.com/np?itag=140', type: 'audio/mp4', bitrate: '128000', encoding: 'aac' }],
    };
  };
  t.after(() => { delete globalThis.__testStreamExtractor; });
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls++;
    throw new Error('Unexpected Invidious fetch');
  });

  const { default: getStreamData, computeStreamValidUntil } = await server.ssrLoadModule('/src/lib/modules/getStreamData.ts');

  const now = 1_700_000_000_000;
  const futureExpire = Math.floor((now + 3_600_000) / 1000);
  // Non-audio video format without expire must not clamp TTL to 60s.
  assert.equal(
    computeStreamValidUntil([
      { url: 'https://r1.googlevideo.com/video', type: 'video/mp4', bitrate: '2000', encoding: '' },
      { url: `https://r1.googlevideo.com/audio?expire=${futureExpire}`, type: 'audio/mp4', bitrate: '128000', encoding: 'aac' },
    ], now),
    now + 5 * 60 * 1000,
  );
  // Malformed URL on one audio format falls back cleanly to 60s without throwing out valid formats.
  assert.equal(
    computeStreamValidUntil([
      { url: 'not-a-valid-url', type: 'audio/webm', bitrate: '64000', encoding: 'opus' },
      { url: `https://r1.googlevideo.com/audio?expire=${futureExpire}`, type: 'audio/mp4', bitrate: '128000', encoding: 'aac' },
    ], now),
    now + 60_000,
  );
  assert.throws(
    () => computeStreamValidUntil([{ url: 'https://r1.googlevideo.com/video', type: 'video/mp4', bitrate: '2000', encoding: '' }], now),
    /No playable audio streams/,
  );

  // prefetch = true on native must fail fast after JS failure without calling NewPipe or Invidious.
  const prefetched = await getStreamData('pIWaVJPl0-c', true);
  assert.equal(prefetched.error, 'Prefetch failed');
  assert.equal(streamExtractorCalls, 0);
  assert.equal(fetchCalls, 0);

  // prefetch = false on native still falls back cleanly to StreamExtractor (NewPipe).
  const active = await getStreamData('pIWaVJPl0-c', false);
  assert.equal(active.title, 'NewPipe Fallback');
  assert.equal(streamExtractorCalls, 1);
  assert.equal(fetchCalls, 0);
});
