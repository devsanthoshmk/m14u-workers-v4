import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import {
  FIXTURE_PLAYER_JS,
  classifyLiveError,
  redactSensitiveUrls,
  runForegroundDeterministicSmoke,
  runHeadlessDeterministicSmoke,
  runLiveSmoke,
} from './resolver-smoke.mjs';

const exec = promisify(execFile);

test('deterministic foreground smoke exercises VISIONOS, fallback QuickJS WASM decipher, and unsafe format filtering', async () => {
  const result = await runForegroundDeterministicSmoke();
  assert.equal(result.visionosFormats, 1);
  assert.deepEqual(result.fallbackClients, [
    'VISIONOS',
    'TVHTML5',
    'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    'MWEB',
  ]);
  assert.equal(result.decipheredHost, 'r3---sn-smoke.googlevideo.com');
});

test('deterministic headless smoke compiles <3MB IIFE in temp dir and exercises bare isolate pump + QuickJS WASM', async () => {
  const result = await runHeadlessDeterministicSmoke();
  assert.ok(result.bundleBytes > 0 && result.bundleBytes < 3_000_000);
  assert.equal(result.visionosFormats, 1);
  assert.equal(result.fallbackFormats, 1);
});

test('live smoke helpers redact signed URLs and distinguish bot_check_ip, decipher_regression, schema_error, and network_error', async () => {
  const redacted = redactSensitiveUrls(
    [
      'Failed GET https://rr1---sn-abc.googlevideo.com/videoplayback?itag=140&sig=SECRET_SIG&n=SECRET_N&pot=SECRET_POT and visitorData=SECRET_VD',
      'raw=1&sparams=SECRET_SPARAMS&sp=SECRET_SP&ip=203.0.113.9&ei=SECRET_EI&id=SECRET_ID&sig=BARE_SIG&n=BARE_N',
      'encoded=s%3DENC_SIG%26sp%3DENC_SP%26sparams%3DENC_SPARAMS%26ip%3D198.51.100.7%26ei%3DENC_EI%26id%3DENC_ID%26url%3Dhttps%253A%252F%252Fr1.googlevideo.com%252Fvideoplayback%253Fn%253DENC_N',
      '{"sig":"JSON_SIG","n":"JSON_N","visitorData":"JSON_VD","signatureCipher":"JSON_CIPHER","sparams":"JSON_SPARAMS","sp":"JSON_SP","ip":"192.0.2.5","ei":"JSON_EI","id":"JSON_ID","token":"JSON_TOK","videoId":"pIWaVJPl0-c"}',
    ].join(' | '),
  );
  for (const secret of [
    'SECRET_SIG',
    'SECRET_N',
    'SECRET_POT',
    'SECRET_VD',
    'SECRET_SPARAMS',
    'SECRET_SP',
    '203.0.113.9',
    'SECRET_EI',
    'SECRET_ID',
    'BARE_SIG',
    'BARE_N',
    'ENC_SIG',
    'ENC_SP',
    'ENC_SPARAMS',
    '198.51.100.7',
    'ENC_EI',
    'ENC_ID',
    'ENC_N',
    'JSON_SIG',
    'JSON_N',
    'JSON_VD',
    'JSON_CIPHER',
    'JSON_SPARAMS',
    'JSON_SP',
    '192.0.2.5',
    'JSON_EI',
    'JSON_ID',
    'JSON_TOK',
  ]) {
    assert.equal(redacted.includes(secret), false, `Expected ${secret} to be redacted`);
  }
  assert.match(redacted, /"videoId":"pIWaVJPl0-c"/);
  assert.match(redacted, /https:\/\/rr1---sn-abc\.googlevideo\.com\/videoplayback\?\[redacted\]/);

  assert.equal(
    classifyLiveError({
      status: 403,
      playabilityStatus: 'LOGIN_REQUIRED',
      playabilityReason: 'Sign in to confirm you’re not a bot',
    }),
    'bot_check_ip',
  );
  assert.equal(
    classifyLiveError({
      stage: 'player-eval',
      message: 'Player extraction missing cipher functions: [rawValues]',
    }),
    'decipher_regression',
  );
  assert.equal(
    classifyLiveError({
      stage: 'iframe-fetch',
      status: 503,
      message: 'iframe_api returned HTTP 503',
    }),
    'network_error',
  );
  assert.equal(
    classifyLiveError({
      stage: 'player-init',
      status: 502,
      message: 'Failed to get player data: 502',
    }),
    'network_error',
  );
  assert.equal(
    classifyLiveError({
      stage: 'player-eval',
      message: 'The operation was aborted due to timeout',
    }),
    'network_error',
  );
  assert.equal(
    classifyLiveError({
      stage: 'schema',
      message: 'Missing player id in /iframe_api response',
    }),
    'schema_error',
  );
  assert.equal(
    classifyLiveError({
      stage: 'network',
      message: 'fetch failed: ETIMEDOUT',
    }),
    'network_error',
  );

  // Verify runLiveSmoke never misclassifies /iframe_api or Player.create network/HTTP errors as decipher_regression.
  const iframeNetReport = await runLiveSmoke({
    tracks: [],
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.equal(iframeNetReport.playerProbe.ok, false);
  assert.equal(iframeNetReport.playerProbe.classification, 'network_error');

  const playerHttp503Report = await runLiveSmoke({
    tracks: [],
    fetch: async (input) => {
      const url = new URL(new Request(input).url);
      if (url.pathname === '/iframe_api') {
        return new Response(String.raw`player\/smoke42\/`, { status: 200 });
      }
      return new Response('upstream error', { status: 503 });
    },
  });
  assert.equal(playerHttp503Report.playerProbe.ok, false);
  assert.equal(playerHttp503Report.playerProbe.classification, 'network_error');

  const iframe403Report = await runLiveSmoke({
    tracks: [],
    fetch: async () => new Response('Forbidden', { status: 403 }),
  });
  assert.equal(iframe403Report.playerProbe.ok, false);
  assert.equal(iframe403Report.playerProbe.classification, 'bot_check_ip');

  const decipherRegressionReport = await runLiveSmoke({
    tracks: [],
    fetch: async (input) => {
      const url = new URL(new Request(input).url);
      if (url.pathname === '/iframe_api') {
        return new Response(String.raw`player\/smoke42\/`, { status: 200 });
      }
      return new Response('(function(a){var x=1;})({});', {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      });
    },
  });
  assert.equal(decipherRegressionReport.playerProbe.ok, false);
  assert.equal(decipherRegressionReport.playerProbe.classification, 'decipher_regression');

  // Exercise runLiveSmoke with a deterministic mock fetch covering player JS, Range probe, and bot-check redaction.
  const rangeHeaders = [];
  const mockLiveFetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.pathname === '/iframe_api') {
      return new Response(String.raw`player\/smoke42\/`, {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (url.pathname === '/s/player/smoke42/player_ias.vflset/en_US/base.js') {
      return new Response(FIXTURE_PLAYER_JS, {
        headers: { 'content-type': 'text/javascript' },
      });
    }
    if (url.pathname === '/youtubei/v1/visitor_id') {
      return Response.json({ responseContext: { visitorData: 'live-visitor-secret' } });
    }
    if (url.pathname === '/youtubei/v1/player') {
      const payload = JSON.parse(await req.text());
      if (payload.videoId === '60ItHLz5WEA') {
        return Response.json({
          playabilityStatus: {
            status: 'LOGIN_REQUIRED',
            reason: 'Sign in to confirm you’re not a bot',
          },
        });
      }
      return Response.json({
        playabilityStatus: { status: 'OK' },
        videoDetails: { title: 'Controlled Live OK' },
        streamingData: {
          adaptiveFormats: [
            {
              url: 'https://r1---sn-live.googlevideo.com/videoplayback?itag=140&sig=TOP_SECRET_TOKEN',
              mimeType: 'audio/mp4; codecs="mp4a.40.2"',
              bitrate: 128000,
            },
          ],
        },
      });
    }
    if (url.hostname === 'r1---sn-live.googlevideo.com') {
      rangeHeaders.push(req.headers.get('range'));
      return new Response(new Uint8Array(1024), { status: 206 });
    }
    throw new Error(`Unexpected live fetch: ${url.origin}${url.pathname}`);
  };

  const liveReport = await runLiveSmoke({ fetch: mockLiveFetch });
  assert.equal(liveReport.playerProbe.ok, true);
  assert.equal(liveReport.playerProbe.playerId, 'smoke42');
  assert.equal(liveReport.tracks[0].videoId, 'pIWaVJPl0-c');
  assert.equal(liveReport.tracks[0].ok, true);
  assert.equal(liveReport.tracks[0].mediaStatus, 206);
  assert.equal(liveReport.tracks[0].bytesReceived, 1024);
  assert.deepEqual(rangeHeaders, ['bytes=0-1023']);
  assert.equal(liveReport.tracks[1].videoId, '60ItHLz5WEA');
  assert.equal(liveReport.tracks[1].ok, false);
  assert.equal(liveReport.tracks[1].classification, 'bot_check_ip');
  assert.equal(liveReport.ok, false);
  assert.equal(liveReport.summaryStatus, 'bot_check_ip');
  assert.equal(JSON.stringify(liveReport).includes('TOP_SECRET_TOKEN'), false);
});

test('CLI --deterministic flag succeeds and rejects unknown flags', async () => {
  const { stdout } = await exec(process.execPath, ['scripts/resolver-smoke.mjs', '--deterministic']);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.mode, 'deterministic');
  assert.equal(parsed.ok, true);

  await assert.rejects(exec(process.execPath, ['scripts/resolver-smoke.mjs', '--unknown-flag']));
});
