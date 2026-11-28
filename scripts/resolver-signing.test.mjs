import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createContext, runInContext } from 'node:vm';
import { test } from 'node:test';

const exec = promisify(execFile);
const verifySignature = (key, message, signature) => verify('sha256', Buffer.from(message), {
  key, dsaEncoding: 'ieee-p1363',
}, Buffer.from(signature, 'base64'));
const canonical = (m) => ['m14u-resolver-v2', m.version, m.abi, m.keyId, m.artifactPath, m.byteLength, m.sha256Hex].join('\n');

test('Node/Kotlin fixture has identical domain-separated bytes', () => {
  const key = { format: 'der', type: 'spki', key: Buffer.from('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvlFXX7FuJMO95Wtj1F0Qx9WxkyhRNnPW+QuSh+B0DQ6gOHzFfGm8LfSEZqEw9MAIPGnlujXsnTLSvLrNNkK0mQ==', 'base64') };
  const message = 'm14u-resolver-v2\n12\nandroidx-js-1\ntest\n/resolvers/v2/12/resolver.js\n3\nfa8571fdfcea0148b09bb44116aa412259b96c4f832d7a0b7d0ddec450083425';
  const signature = 'GvN41kqFYPkm4vM/ZFXua4omY//frLfne0LcLjaDI8ArKCGX79IdFaKjwA4wxA+uDmLyhHHDpNoWeew8BpmsIQ==';
  assert.equal(verifySignature(createPublicKey(key), message, signature), true);
  assert.equal(verifySignature(createPublicKey(key), message + '\n', signature), false);
});

test('builds legacy v1 and signed single-file v2; exercises bare-isolate pump and inline WASM', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'm14u-signing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = join(dir, 'key.pem');
  await writeFile(pem, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const legacyPath = join(dir, 'resolver.json');
  const v2Path = join(dir, 'v2');
  await Promise.all([exec(process.execPath, ['scripts/build-resolver.mjs', '7', pem, legacyPath]),
    exec(process.execPath, ['scripts/build-resolver.mjs', '--v2', '8', pem, v2Path, 'test'])]);
  const legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
  assert.deepEqual(Object.keys(legacy), ['version', 'code', 'signature']);
  assert.equal(verifySignature(publicKey, `m14u-resolver-v1\n7\n${legacy.code}`, legacy.signature), true);
  const manifest = JSON.parse(await readFile(join(v2Path, 'manifest.json'), 'utf8'));
  const artifact = await readFile(join(v2Path, '8/resolver.js'));
  assert.deepEqual((await readdir(v2Path)).sort(), ['8', 'manifest.json']);
  assert.deepEqual(await readdir(join(v2Path, '8')), ['resolver.js']);
  assert.equal(manifest.artifactPath, '/resolvers/v2/8/resolver.js');
  assert.equal(manifest.byteLength, artifact.byteLength);
  assert.ok(artifact.byteLength < 3_000_000);
  assert.equal(manifest.sha256Hex, createHash('sha256').update(artifact).digest('hex'));
  assert.equal(verifySignature(publicKey, canonical(manifest), manifest.signature), true);
  assert.equal(verifySignature(publicKey, canonical({ ...manifest, abi: 'other' }), manifest.signature), false);

  const context = createContext();
  const named = new Map();
  const evaluate = (source) => runInContext(source, context, { timeout: 3000 });
  context.android = { async consumeNamedDataAsArrayBuffer(name) {
    const raw = named.get(name);
    named.delete(name);
    return evaluate(`Uint8Array.from(${JSON.stringify([...raw])}).buffer`);
  } };
  evaluate(artifact.toString());
  assert.equal(await evaluate('m14uResolver.selfTest()'), '42');
  assert.equal(evaluate('m14uResolver.start("pIWaVJPl0-c")'), 'ok');
  let seen = [];
  for (let i = 0; i < 20; i++) {
    await new Promise(setImmediate);
    const frame = JSON.parse(evaluate('m14uResolver.drain()'));
    if (frame.done) {
      assert.equal(frame.result?.title, 'Fixture 🎵');
      assert.equal(frame.result?.adaptiveFormats[0].encoding, 'opus');
      assert.deepEqual(seen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player']);
      break;
    }
    for (const request of frame.requests) {
      const { pathname } = new URL(request.url);
      seen.push(pathname);
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['content-type'], 'application/json');
      const payload = JSON.parse(request.body);
      let body;
      if (pathname === '/youtubei/v1/visitor_id') {
        assert.equal(payload.context.client.clientName, 'VISIONOS');
        body = JSON.stringify({ responseContext: { visitorData: 'fixture-visitor' } });
      } else {
        assert.equal(pathname, '/youtubei/v1/player');
        assert.equal(payload.videoId, 'pIWaVJPl0-c');
        assert.equal(request.headers['x-goog-visitor-id'], 'fixture-visitor');
        body = JSON.stringify({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Fixture 🎵' }, streamingData: {
          adaptiveFormats: [{ url: 'https://r1.googlevideo.com/videoplayback?itag=251', mimeType: 'audio/webm; codecs="opus"', bitrate: 1000 }],
        } });
      }
      named.set('reply', Buffer.from(JSON.stringify({ status: 200, type: 'application/json', body: Buffer.from(body).toString('base64') })));
      assert.equal(await evaluate(`m14uResolver.reply(${request.id},"reply")`), 'ok');
    }
  }
  assert.equal(seen.length, 2);

  // Also verify fallback path (VISIONOS unavailable -> Player.create + QuickJS WASM + TV client) in a fresh isolate.
  const fallbackContext = createContext();
  const fallbackNamed = new Map();
  const evalFallback = (source) => runInContext(source, fallbackContext, { timeout: 3000 });
  fallbackContext.android = { async consumeNamedDataAsArrayBuffer(name) {
    const raw = fallbackNamed.get(name);
    fallbackNamed.delete(name);
    return evalFallback(`Uint8Array.from(${JSON.stringify([...raw])}).buffer`);
  } };
  evalFallback(artifact.toString());
  assert.equal(evalFallback('m14uResolver.start("pIWaVJPl0-c")'), 'ok');
  seen = [];
  for (let i = 0; i < 20; i++) {
    await new Promise(setImmediate);
    const frame = JSON.parse(evalFallback('m14uResolver.drain()'));
    if (frame.done) {
      assert.equal(frame.result?.title, 'Fallback 🎵');
      assert.equal(frame.result?.adaptiveFormats[0].encoding, 'opus');
      assert.deepEqual(seen, ['/youtubei/v1/visitor_id', '/youtubei/v1/player', '/iframe_api', '/s/player/fixture/player_ias.vflset/en_US/base.js', '/youtubei/v1/player']);
      return;
    }
    for (const request of frame.requests) {
      const { pathname } = new URL(request.url);
      seen.push(pathname);
      let body, type;
      if (pathname === '/iframe_api') body = String.raw`player\/fixture\/`;
      else if (pathname.endsWith('/base.js')) body = '(function(a){var x=1;} )({});';
      else if (pathname === '/youtubei/v1/visitor_id') {
        type = 'application/json';
        body = JSON.stringify({ responseContext: { visitorData: 'fixture-visitor' } });
      } else {
        type = 'application/json';
        const payload = JSON.parse(request.body);
        if (payload.context.client.clientName === 'VISIONOS') {
          body = JSON.stringify({ playabilityStatus: { status: 'UNPLAYABLE' } });
        } else {
          body = JSON.stringify({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Fallback 🎵' }, streamingData: {
            adaptiveFormats: [{ url: 'https://r1.googlevideo.com/videoplayback?itag=251', mimeType: 'audio/webm; codecs="opus"', bitrate: 1000 }],
          } });
        }
      }
      fallbackNamed.set('reply', Buffer.from(JSON.stringify({ status: 200, type: type ?? 'text/javascript', body: Buffer.from(body).toString('base64') })));
      assert.equal(await evalFallback(`m14uResolver.reply(${request.id},"reply")`), 'ok');
    }
  }
  assert.fail('fallback pump did not settle');
});
