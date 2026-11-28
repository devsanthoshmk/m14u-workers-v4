import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { build } from 'vite';
import { Player } from 'youtubei.js/web';
import { createCapacitorFetch, evaluatePlayerScript } from '../src/lib/modules/resolver/capacitorTransport.ts';
import { configureYouTubeEvaluator, resolveYouTubeStreams } from '../src/lib/modules/resolver/core.ts';

export const LIVE_SMOKE_TRACKS = ['pIWaVJPl0-c', '60ItHLz5WEA'];
export const HEADLESS_BUNDLE_LIMIT_BYTES = 3_000_000;

export const FIXTURE_PLAYER_JS = `(function(g){
  var sigImpl = function(a) { return a.split("").reverse().join(""); };
  var sigWrapper = function(a, b, c) { b && (c = sigImpl(decodeURIComponent(c)), a.set("sig", c)); };
  var nImpl = function(a) { return a.indexOf("fail_") === 0 ? "enhanced_except_" + a : "dec_" + a; };
  var nList = [nImpl];
  var stsHelper = function() { return { signatureTimestamp: 20123 }; };
})({});`;

const SENSITIVE_PARAM_NAMES =
  'sig|signature|lsig|signatureCipher|cipher|s|n|pot|poToken|po_token|sparams|sp|ip|ipbits|ei|id|visitorData|visitor_data|key|token|access_token';
const JSON_SECRET_RE = new RegExp(
  `(["'])(${SENSITIVE_PARAM_NAMES})\\1\\s*:\\s*(["'])(?:\\\\.|(?!\\3).)*\\3`,
  'gi',
);
const ENCODED_PARAM_RE = new RegExp(
  `(^|%26|%2526|%3F|%253F|[?&=\\s,"'\`;])(${SENSITIVE_PARAM_NAMES})(?:%253D|%3D)(?:(?!(?:%2526|%26|[&\\s"',;])).)+`,
  'gi',
);
const RAW_PARAM_RE = new RegExp(
  `(^|[?&\\s,"'\`;])(${SENSITIVE_PARAM_NAMES})=([^&\\s"',;]+)`,
  'gi',
);

export function redactSensitiveUrls(input) {
  let text = String(input ?? '');
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      const isMedia = parsed.hostname.endsWith('.googlevideo.com');
      const hasParams = Boolean(parsed.search || parsed.hash);
      if (isMedia || hasParams) {
        return `${parsed.origin}${parsed.pathname}${hasParams ? '?[redacted]' : ''}`;
      }
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return '[redacted-url]';
    }
  });
  text = text.replace(/https?(?:%253A%252F%252F|%3A%2F%2F)(?:(?!(?:%26|%2526|[\s"'<>])).)+/gi, '[redacted-url]');
  text = text.replace(JSON_SECRET_RE, '$1$2$1: $3[redacted]$3');
  text = text.replace(ENCODED_PARAM_RE, '$1$2=[redacted]');
  text = text.replace(RAW_PARAM_RE, '$1$2=[redacted]');
  return text;
}

export function classifyLiveError(context = {}) {
  const {
    stage = '',
    status = 0,
    playabilityStatus = '',
    playabilityReason = '',
    message = '',
  } = context;
  const combined = `${playabilityStatus} ${playabilityReason} ${message}`;

  if (
    status === 403 ||
    status === 429 ||
    playabilityStatus === 'LOGIN_REQUIRED' ||
    /sign in to confirm|not a bot|unusual traffic|captcha|bot_check/i.test(combined)
  ) {
    return 'bot_check_ip';
  }

  if (
    stage === 'network' ||
    status >= 500 ||
    (status >= 400 && status !== 403 && status !== 429) ||
    /fetch failed|networkerror|network error|timeout|timed out|aborted|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|Failed to get player (?:id|data): (?:4\d\d|5\d\d)/i.test(
      combined,
    )
  ) {
    return 'network_error';
  }

  if (stage === 'iframe-fetch') {
    return 'network_error';
  }

  if (stage === 'schema') {
    return 'schema_error';
  }

  if (stage === 'player-init') {
    if (/decipher|sigFunction|nFunction|enhanced_except_|JsExtractor|JsAnalyzer/i.test(combined)) {
      return 'decipher_regression';
    }
    return 'schema_error';
  }

  if (
    stage === 'player-eval' ||
    stage === 'decipher' ||
    /decipher|sigFunction|nFunction|enhanced_except_|signature/i.test(combined)
  ) {
    return 'decipher_regression';
  }

  if (/player id|visitorData|ParsingError|Unexpected token|JSON|schema/i.test(combined)) {
    return 'schema_error';
  }

  return 'schema_error';
}

function createBridgeBackedFetch(handler) {
  return createCapacitorFetch(async (options) => {
    const response = await handler(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.data,
    });
    const text = await response.text();
    return {
      status: response.status,
      url: options.url,
      data: text,
      headers: Object.fromEntries(response.headers.entries()),
    };
  });
}

async function buildHeadlessBundleInTempDir(tempDir) {
  let inlinedWasm = false;
  const headlessWasm = {
    name: 'm14u-headless-wasm',
    enforce: 'pre',
    async transform(source, id) {
      if (!id.includes('/quickjs-wasmfile-release-sync/dist/emscripten-module.browser.mjs')) return;
      const anchor = 'moduleArg={}){';
      const asset = '(new URL("emscripten-module.wasm",import.meta.url)).href';
      if (!source.includes(anchor) || !source.includes(asset)) {
        throw new Error('QuickJS loader changed; review headless WASM wiring');
      }
      const bytes = await readFile(join(id, '..', 'emscripten-module.wasm'));
      inlinedWasm = true;
      return source
        .replace(
          anchor,
          `${anchor}moduleArg.wasmBinary??=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0));`,
        )
        .replace(asset, '"inline-quickjs.wasm"')
        .replaceAll('import.meta.url', '"https://headless.invalid/"');
    },
  };

  const bundles = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    plugins: [headlessWasm],
    build: {
      outDir: tempDir,
      emptyOutDir: true,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: {
        entry: fileURLToPath(new URL('./resolver-headless.ts', import.meta.url)),
        name: 'M14UResolver',
        formats: ['iife'],
        fileName: () => 'resolver.js',
      },
    },
  });

  assert.equal(inlinedWasm, true, 'Expected QuickJS WASM to be inlined into headless bundle');
  const [bundle] = Array.isArray(bundles) ? bundles : [];
  const [entry] = bundle?.output ?? [];
  assert.ok(Array.isArray(bundles) && bundles.length === 1 && bundle?.output.length === 1);
  assert.equal(entry?.type, 'chunk');
  assert.equal(entry?.isEntry, true);
  assert.equal(entry.imports.length, 0, 'Headless bundle must not contain external imports');
  assert.equal(entry.dynamicImports.length, 0, 'Headless bundle must not contain dynamic imports');

  const files = await readdir(tempDir);
  assert.deepEqual(files, ['resolver.js'], 'Headless build output must contain only resolver.js');
  const artifact = await readFile(join(tempDir, 'resolver.js'));
  assert.ok(
    artifact.byteLength > 0 && artifact.byteLength < HEADLESS_BUNDLE_LIMIT_BYTES,
    `Expected headless bundle < ${HEADLESS_BUNDLE_LIMIT_BYTES} bytes, got ${artifact.byteLength}`,
  );
  return artifact;
}

async function runHeadlessIsolate(artifactBuffer, videoId, onRequest) {
  const context = createContext();
  const named = new Map();
  const evaluate = (source) => runInContext(source, context, { timeout: 3000 });
  context.android = {
    async consumeNamedDataAsArrayBuffer(name) {
      const raw = named.get(name);
      named.delete(name);
      return evaluate(`Uint8Array.from(${JSON.stringify([...raw])}).buffer`);
    },
  };
  evaluate(artifactBuffer.toString('utf8'));
  assert.equal(await evaluate('m14uResolver.selfTest()'), '42');
  assert.equal(evaluate(`m14uResolver.start(${JSON.stringify(videoId)})`), 'ok');

  for (let i = 0; i < 40; i++) {
    await new Promise(setImmediate);
    const frame = JSON.parse(evaluate('m14uResolver.drain()'));
    if (frame.done) {
      return frame.result;
    }
    for (const request of frame.requests) {
      const reply = await onRequest(request);
      named.set(
        'reply',
        Buffer.from(
          JSON.stringify({
            status: reply.status ?? 200,
            type: reply.type ?? 'application/json',
            body: Buffer.from(reply.body).toString('base64'),
          }),
        ),
      );
      assert.equal(await evaluate(`m14uResolver.reply(${request.id}, "reply")`), 'ok');
    }
  }
  throw new Error('Headless isolate HTTP pump did not settle');
}

export async function runForegroundDeterministicSmoke() {
  configureYouTubeEvaluator(evaluatePlayerScript);

  // 1. VISIONOS happy path + unsafe format filtering through Capacitor transport.
  const visionosSeen = [];
  const visionosFetch = createBridgeBackedFetch(async (input, init) => {
    const path = new URL(input).pathname;
    visionosSeen.push(path);
    if (path === '/youtubei/v1/visitor_id') {
      return Response.json({ responseContext: { visitorData: 'smoke-visitor-1' } });
    }
    assert.equal(path, '/youtubei/v1/player');
    const payload = JSON.parse(String(init?.body ?? '{}'));
    assert.equal(payload.context.client.clientName, 'VISIONOS');
    assert.equal(payload.context.client.visitorData, 'smoke-visitor-1');
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Foreground VISIONOS' },
      streamingData: {
        adaptiveFormats: [
          {
            url: 'https://r1---sn-smoke.googlevideo.com/videoplayback?itag=140&expire=1900000000',
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
          },
          {
            url: 'https://r1---sn-smoke.googlevideo.com/videoplayback?itag=251&sabr=1',
            mimeType: 'audio/webm; codecs="opus"',
            bitrate: 160000,
          },
          {
            url: 'https://evil.example/videoplayback?itag=251',
            mimeType: 'audio/webm; codecs="opus"',
            bitrate: 160000,
          },
          {
            url: 'https://r1---sn-smoke.googlevideo.com/videoplayback?itag=140&n=enhanced_except_blocked',
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
          },
          {
            url: 'http://r1---sn-smoke.googlevideo.com/videoplayback?itag=140',
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
          },
          {
            url: 'https://r1---sn-smoke.googlevideo.com/videoplayback?itag=137',
            mimeType: 'video/mp4; codecs="avc1.640028"',
            bitrate: 2000000,
          },
        ],
      },
    });
  });

  const visionosResult = await resolveYouTubeStreams('pIWaVJPl0-c', { fetch: visionosFetch });
  assert.deepEqual(visionosSeen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player']);
  assert.equal(visionosResult.title, 'Foreground VISIONOS');
  assert.equal(visionosResult.adaptiveFormats.length, 1);
  assert.equal(visionosResult.adaptiveFormats[0].encoding, 'aac');

  // 2. VISIONOS failure -> Player.create (TV -> TV_EMBEDDED -> MWEB) + QuickJS WASM sig/n deciphering.
  const fallbackClients = [];
  const fallbackFetch = createBridgeBackedFetch(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/youtubei/v1/visitor_id') {
      return Response.json({ responseContext: { visitorData: 'smoke-visitor-2' } });
    }
    if (path === '/iframe_api') {
      return new Response(String.raw`player\/smoke42\/`, {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (path === '/s/player/smoke42/player_ias.vflset/en_US/base.js') {
      return new Response(FIXTURE_PLAYER_JS, {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    assert.equal(path, '/youtubei/v1/player');
    const payload = JSON.parse(String(init?.body ?? '{}'));
    const clientName = payload.context.client.clientName;
    fallbackClients.push(clientName);

    if (clientName === 'VISIONOS' || clientName === 'TVHTML5') {
      return Response.json({ playabilityStatus: { status: 'UNPLAYABLE' } });
    }
    if (clientName === 'TVHTML5_SIMPLY_EMBEDDED_PLAYER') {
      return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: { title: 'Filtered Out Embedded' },
        streamingData: {
          adaptiveFormats: [
            {
              url: 'https://r2---sn-smoke.googlevideo.com/videoplayback?itag=251&sabr=1&n=raw1',
              mimeType: 'audio/webm; codecs="opus"',
              bitrate: 128000,
            },
            {
              url: 'https://untrusted.example/audio?itag=251&n=raw2',
              mimeType: 'audio/webm; codecs="opus"',
              bitrate: 128000,
            },
          ],
        },
      });
    }
    assert.equal(clientName, 'MWEB');
    assert.equal(payload.playbackContext?.contentPlaybackContext?.signatureTimestamp, 20123);
    const cipheredUrl = encodeURIComponent(
      'https://r3---sn-smoke.googlevideo.com/videoplayback?itag=251&n=rawN1',
    );
    return Response.json({
      playabilityStatus: { status: 'OK' },
      videoDetails: { title: 'Foreground MWEB Deciphered' },
      streamingData: {
        adaptiveFormats: [
          {
            signatureCipher: `s=321cba&sp=sig&url=${cipheredUrl}`,
            mimeType: 'audio/webm; codecs="opus"',
            bitrate: 140000,
          },
          {
            url: 'https://r3---sn-smoke.googlevideo.com/videoplayback?itag=140&n=fail_blocked',
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
          },
          {
            url: 'https://r3---sn-smoke.googlevideo.com/videoplayback?itag=140&sabr=1&n=rawN2',
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
          },
          {
            url: 'https://not-googlevideo.example/videoplayback?itag=140&n=rawN3',
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
          },
        ],
      },
    });
  });

  const fallbackResult = await resolveYouTubeStreams('60ItHLz5WEA', { fetch: fallbackFetch });
  assert.deepEqual(fallbackClients, [
    'VISIONOS',
    'TVHTML5',
    'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    'MWEB',
  ]);
  assert.equal(fallbackResult.title, 'Foreground MWEB Deciphered');
  assert.equal(fallbackResult.adaptiveFormats.length, 1);
  const deciphered = new URL(fallbackResult.adaptiveFormats[0].url);
  assert.equal(deciphered.hostname, 'r3---sn-smoke.googlevideo.com');
  assert.equal(deciphered.searchParams.get('n'), 'dec_rawN1');
  assert.equal(deciphered.searchParams.get('sig'), 'abc123');
  assert.equal(fallbackResult.adaptiveFormats[0].encoding, 'opus');

  return {
    visionosFormats: visionosResult.adaptiveFormats.length,
    fallbackClients,
    decipheredHost: deciphered.hostname,
  };
}

export async function runHeadlessDeterministicSmoke() {
  const tempDir = await mkdtemp(join(tmpdir(), 'm14u-smoke-'));
  try {
    const artifact = await buildHeadlessBundleInTempDir(tempDir);

    // 1. Bare isolate VISIONOS happy path + filtering.
    const visionosSeen = [];
    const visionosResult = await runHeadlessIsolate(artifact, 'pIWaVJPl0-c', async (request) => {
      const { pathname } = new URL(request.url);
      visionosSeen.push(pathname);
      if (pathname === '/youtubei/v1/visitor_id') {
        return { body: JSON.stringify({ responseContext: { visitorData: 'headless-visitor-1' } }) };
      }
      assert.equal(pathname, '/youtubei/v1/player');
      const payload = JSON.parse(request.body);
      assert.equal(payload.context.client.clientName, 'VISIONOS');
      return {
        body: JSON.stringify({
          playabilityStatus: { status: 'OK' },
          videoDetails: { title: 'Headless VISIONOS' },
          streamingData: {
            adaptiveFormats: [
              {
                url: 'https://r1---sn-headless.googlevideo.com/videoplayback?itag=251',
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 128000,
              },
              {
                url: 'https://r1---sn-headless.googlevideo.com/videoplayback?itag=251&sabr=1',
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 128000,
              },
              {
                url: 'https://bad-host.example/videoplayback?itag=251',
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 128000,
              },
            ],
          },
        }),
      };
    });
    assert.deepEqual(visionosSeen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player']);
    assert.equal(visionosResult?.title, 'Headless VISIONOS');
    assert.equal(visionosResult?.adaptiveFormats.length, 1);

    // 2. Bare isolate VISIONOS failure -> Player.create + inline QuickJS WASM sig/n deciphering.
    const fallbackSeen = [];
    const fallbackResult = await runHeadlessIsolate(artifact, '60ItHLz5WEA', async (request) => {
      const { pathname } = new URL(request.url);
      fallbackSeen.push(pathname);
      if (pathname === '/iframe_api') {
        return { type: 'text/javascript', body: String.raw`player\/smoke42\/` };
      }
      if (pathname === '/s/player/smoke42/player_ias.vflset/en_US/base.js') {
        return { type: 'text/javascript', body: FIXTURE_PLAYER_JS };
      }
      if (pathname === '/youtubei/v1/visitor_id') {
        return { body: JSON.stringify({ responseContext: { visitorData: 'headless-visitor-2' } }) };
      }
      assert.equal(pathname, '/youtubei/v1/player');
      const payload = JSON.parse(request.body);
      if (payload.context.client.clientName === 'VISIONOS') {
        return { body: JSON.stringify({ playabilityStatus: { status: 'UNPLAYABLE' } }) };
      }
      assert.equal(payload.context.client.clientName, 'TVHTML5');
      assert.equal(payload.playbackContext?.contentPlaybackContext?.signatureTimestamp, 20123);
      const cipheredUrl = encodeURIComponent(
        'https://r4---sn-headless.googlevideo.com/videoplayback?itag=140&n=rawHeadless',
      );
      return {
        body: JSON.stringify({
          playabilityStatus: { status: 'OK' },
          videoDetails: { title: 'Headless Ciphered TV' },
          streamingData: {
            adaptiveFormats: [
              {
                signatureCipher: `s=654fed&sp=sig&url=${cipheredUrl}`,
                mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                bitrate: 131000,
              },
              {
                url: 'https://r4---sn-headless.googlevideo.com/videoplayback?itag=251&n=fail_headless',
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 128000,
              },
              {
                url: 'https://r4---sn-headless.googlevideo.com/videoplayback?itag=251&sabr=1&n=rawOk',
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 128000,
              },
              {
                url: 'https://non-google.example/videoplayback?itag=251&n=rawOk',
                mimeType: 'audio/webm; codecs="opus"',
                bitrate: 128000,
              },
            ],
          },
        }),
      };
    });

    assert.deepEqual(fallbackSeen, [
      '/youtubei/v1/visitor_id',
      '/youtubei/v1/player',
      '/iframe_api',
      '/s/player/smoke42/player_ias.vflset/en_US/base.js',
      '/youtubei/v1/player',
    ]);
    assert.equal(fallbackResult?.title, 'Headless Ciphered TV');
    assert.equal(fallbackResult?.adaptiveFormats.length, 1);
    const deciphered = new URL(fallbackResult.adaptiveFormats[0].url);
    assert.equal(deciphered.hostname, 'r4---sn-headless.googlevideo.com');
    assert.equal(deciphered.searchParams.get('n'), 'dec_rawHeadless');
    assert.equal(deciphered.searchParams.get('sig'), 'def456');
    assert.equal(fallbackResult.adaptiveFormats[0].encoding, 'aac');

    return {
      bundleBytes: artifact.byteLength,
      visionosFormats: visionosResult.adaptiveFormats.length,
      fallbackFormats: fallbackResult.adaptiveFormats.length,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runDeterministicSmoke() {
  const foreground = await runForegroundDeterministicSmoke();
  const headless = await runHeadlessDeterministicSmoke();
  return { ok: true, foreground, headless };
}

export async function runLiveSmoke(options = {}) {
  const tracks = options.tracks ?? LIVE_SMOKE_TRACKS;
  const baseFetch = options.fetch ?? globalThis.fetch;
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

  configureYouTubeEvaluator(evaluatePlayerScript);

  const playerProbe = {
    ok: false,
    classification: 'ok',
    playerId: null,
    exported: [],
    signatureTimestamp: 0,
    error: null,
  };

  let playerStage = 'iframe-fetch';
  let playerHttpStatus = 0;
  let playerNetworkError = false;

  try {
    let iframeRes;
    try {
      iframeRes = await baseFetch('https://www.youtube.com/iframe_api', {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      playerNetworkError = true;
      throw error;
    }
    playerHttpStatus = iframeRes.status;
    if (!iframeRes.ok) {
      playerProbe.classification = classifyLiveError({
        stage: 'iframe-fetch',
        status: iframeRes.status,
        message: `iframe_api HTTP ${iframeRes.status}`,
      });
      throw new Error(`iframe_api returned HTTP ${iframeRes.status}`);
    }
    const iframeJs = await iframeRes.text();
    const idMatch = /player\\?\/([A-Za-z0-9_-]+)\\?\//.exec(iframeJs);
    if (!idMatch) {
      playerStage = 'schema';
      playerProbe.classification = classifyLiveError({
        stage: 'schema',
        message: 'Missing player id in /iframe_api response',
      });
      throw new Error('Missing player id in /iframe_api response');
    }
    playerProbe.playerId = idMatch[1];

    playerStage = 'player-init';
    playerHttpStatus = 0;
    const player = await Player.create(
      undefined,
      async (input, init) => {
        const headers = new Headers(init?.headers);
        if (!headers.has('user-agent')) headers.set('user-agent', userAgent);
        try {
          const res = await baseFetch(input, {
            ...init,
            headers,
            credentials: 'omit',
            signal: AbortSignal.timeout(15_000),
          });
          playerHttpStatus = res.status;
          return res;
        } catch (error) {
          playerNetworkError = true;
          throw error;
        }
      },
      undefined,
      playerProbe.playerId,
    );

    playerStage = 'player-eval';
    const exported = player.data?.exported ?? [];
    playerProbe.exported = exported;
    playerProbe.signatureTimestamp = player.signature_timestamp ?? 0;

    if (!player.data?.output || !exported.includes('sigFunction') || !exported.includes('nFunction')) {
      playerProbe.classification = 'decipher_regression';
      throw new Error(`Player extraction missing cipher functions: [${exported.join(', ')}]`);
    }

    const evalOut = await evaluatePlayerScript(player.data, {
      sig: 'smoke_test_sig_1234',
      n: 'smoke_test_n_1234',
    });
    if (
      typeof evalOut?.sig !== 'string' ||
      typeof evalOut?.n !== 'string' ||
      evalOut.n.startsWith('enhanced_except_')
    ) {
      playerProbe.classification = 'decipher_regression';
      throw new Error('QuickJS evaluation returned invalid sig or enhanced_except_ n parameter');
    }
    playerProbe.ok = true;
  } catch (error) {
    if (playerProbe.classification === 'ok') {
      playerProbe.classification = classifyLiveError({
        stage: playerNetworkError ? 'network' : playerStage,
        status: playerHttpStatus,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    playerProbe.error = redactSensitiveUrls(error instanceof Error ? error.message : String(error));
  }

  const trackResults = [];
  for (const videoId of tracks) {
    const telemetry = {
      lastStatus: 0,
      playabilityStatus: '',
      playabilityReason: '',
      sawSignatureCipher: false,
      sawMissingVisitorData: false,
      sawNetworkError: false,
    };

    const observedFetch = async (input, init) => {
      const request = new Request(input, init);
      const pathname = new URL(request.url).pathname;
      try {
        const res = await baseFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
        telemetry.lastStatus = res.status;
        if (pathname === '/youtubei/v1/visitor_id' && res.ok) {
          const clone = await res.clone().json().catch(() => null);
          if (!clone?.responseContext?.visitorData) telemetry.sawMissingVisitorData = true;
        } else if (pathname === '/youtubei/v1/player' && res.ok) {
          const clone = await res.clone().json().catch(() => null);
          if (clone?.playabilityStatus?.status && clone.playabilityStatus.status !== 'OK') {
            telemetry.playabilityStatus = String(clone.playabilityStatus.status);
            telemetry.playabilityReason = redactSensitiveUrls(clone.playabilityStatus.reason ?? '');
          }
          const formats = clone?.streamingData?.adaptiveFormats ?? [];
          if (formats.some((f) => Boolean(f?.signatureCipher || f?.cipher))) {
            telemetry.sawSignatureCipher = true;
          }
        }
        return res;
      } catch (error) {
        telemetry.sawNetworkError = true;
        throw error;
      }
    };

    const entry = {
      videoId,
      ok: false,
      classification: 'ok',
      host: null,
      encoding: null,
      mediaStatus: null,
      bytesReceived: 0,
      error: null,
    };

    try {
      const resolved = await resolveYouTubeStreams(videoId, {
        fetch: observedFetch,
        signal: AbortSignal.timeout(25_000),
      });
      const chosen =
        resolved.adaptiveFormats.find((f) => f.encoding === 'aac') ?? resolved.adaptiveFormats[0];
      if (!chosen) {
        entry.classification = 'schema_error';
        throw new Error('No audio format returned');
      }

      const mediaUrl = new URL(chosen.url);
      entry.host = mediaUrl.hostname;
      entry.encoding = chosen.encoding || 'unknown';

      const rangeRes = await baseFetch(chosen.url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
        signal: AbortSignal.timeout(12_000),
      });
      entry.mediaStatus = rangeRes.status;
      if (rangeRes.status !== 206 && rangeRes.status !== 200) {
        await rangeRes.body?.cancel().catch(() => {});
        entry.classification = classifyLiveError({
          stage: 'network',
          status: rangeRes.status,
          message: `Media range check returned HTTP ${rangeRes.status}`,
        });
        throw new Error(`Media range check returned HTTP ${rangeRes.status}`);
      }
      const bytes = new Uint8Array(await rangeRes.arrayBuffer());
      entry.bytesReceived = bytes.byteLength;
      if (bytes.byteLength === 0) {
        entry.classification = 'schema_error';
        throw new Error('Media range response returned 0 bytes');
      }
      entry.ok = true;
    } catch (error) {
      if (entry.classification === 'ok') {
        const msg = error instanceof Error ? error.message : String(error);
        entry.classification = classifyLiveError({
          stage: telemetry.sawNetworkError
            ? 'network'
            : telemetry.sawMissingVisitorData
              ? 'schema'
              : telemetry.sawSignatureCipher
                ? 'decipher'
                : '',
          status: telemetry.lastStatus,
          playabilityStatus: telemetry.playabilityStatus,
          playabilityReason: telemetry.playabilityReason,
          message: msg,
        });
      }
      entry.error = redactSensitiveUrls(error instanceof Error ? error.message : String(error));
    }

    trackResults.push(entry);
  }

  const allTracksOk = trackResults.length > 0 && trackResults.every((t) => t.ok);
  const ok = playerProbe.ok && allTracksOk;
  const classifications = new Set(
    [
      ...(playerProbe.ok ? [] : [playerProbe.classification]),
      ...trackResults.filter((t) => !t.ok).map((t) => t.classification),
    ].filter(Boolean),
  );

  return {
    ok,
    summaryStatus: ok ? 'ok' : [...classifications].join(','),
    playerProbe,
    tracks: trackResults,
  };
}

function formatLiveSummaryMarkdown(report) {
  const lines = [
    '### Advisory YouTube Live Smoke Probe',
    '',
    `- **Overall:** ${report.ok ? 'PASS' : `WARN (${report.summaryStatus})`}`,
    `- **Player JS + QuickJS:** ${report.playerProbe.ok ? 'PASS' : `FAIL (${report.playerProbe.classification})`} (playerId=${report.playerProbe.playerId ?? 'n/a'}, sts=${report.playerProbe.signatureTimestamp}, exported=${report.playerProbe.exported.join(',') || 'none'})`,
    '',
    '| Video ID | Result | Classification | Media Host | Encoding | Media HTTP | Bytes | Note |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const t of report.tracks) {
    lines.push(
      `| \`${t.videoId}\` | ${t.ok ? 'PASS' : 'FAIL'} | \`${t.classification}\` | ${t.host ?? '-'} | ${t.encoding ?? '-'} | ${t.mediaStatus ?? '-'} | ${t.bytesReceived} | ${t.error ? redactSensitiveUrls(t.error).replace(/\|/g, '/') : '-'} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  let mode = 'deterministic';
  let summaryFile = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--deterministic') {
      mode = 'deterministic';
    } else if (arg === '--live') {
      mode = 'live';
    } else if (arg === '--summary-file') {
      summaryFile = args[++i];
      if (!summaryFile) throw new Error('--summary-file requires a path');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (mode === 'deterministic') {
    const report = await runDeterministicSmoke();
    console.log(JSON.stringify({ mode: 'deterministic', ...report }));
    return;
  }

  const report = await runLiveSmoke();
  console.log(JSON.stringify({ mode: 'live', ...report }));
  if (summaryFile) {
    await writeFile(summaryFile, formatLiveSummaryMarkdown(report), 'utf8');
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

const isEntrypoint =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error(redactSensitiveUrls(error instanceof Error ? error.stack ?? error.message : String(error)));
    process.exit(1);
  });
}
