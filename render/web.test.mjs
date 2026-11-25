import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWebServer } from './web.mjs';

async function fixture(t, options = {}) {
  const dist = await mkdtemp(join(tmpdir(), 'm14u-web-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<main>SPA</main>');
  await writeFile(join(dist, 'assets/app.js'), 'export {};');
  const server = createWebServer({ dist, saavn: () => Response.json({}, { status: 404 }), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((done) => server.close(done));
    await rm(dist, { recursive: true });
  });
  return (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
}

test('serves the SPA, assets and health check without falling back for missing assets or APIs', async (t) => {
  const request = await fixture(t);
  assert.equal(await (await request('/album/123')).text(), '<main>SPA</main>');
  assert.deepEqual(await (await request('/healthz')).json(), { ok: true });
  const asset = await request('/assets/app.js');
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), 'export {};');
  assert.equal((await request('/assets/missing.js')).status, 404);
  assert.equal((await request('/api/unknown')).status, 404);
});

test('passes API status, headers, query and response shape through unmodified', async (t) => {
  const body = { success: false, upstream: ['response'] };
  const request = await fixture(t, { saavn: (req) => {
    const url = new URL(req.url);
    assert.equal(url.pathname, '/api/search/songs');
    assert.equal(url.searchParams.get('query'), 'a & b');
    return Response.json(body, { status: 422, headers: { 'x-upstream': 'saavn' } });
  } });
  const res = await request('/api/search/songs?query=a+%26+b');
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('x-upstream'), 'saavn');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), body);
});

test('relays highest-bitrate CDN audio with byte ranges, HEAD and 416', async (t) => {
  const request = await fixture(t, {
    saavn: (req) => {
      assert.equal(new URL(req.url).searchParams.get('ids'), 'track-01');
      return Response.json({ success: true, data: [{ id: 'track-01', downloadUrl: [
        { quality: '320kbps', url: 'https://aac.saavncdn.com/best.mp4' },
        { quality: '96kbps', url: 'https://aac.saavncdn.com/other.mp4' },
      ] }] });
    },
    fetchMedia: async (url, { method, redirect, headers }) => {
      assert.equal(url.href, 'https://aac.saavncdn.com/best.mp4');
      assert.equal(redirect, 'error');
      assert.equal(headers['accept-encoding'], 'identity');
      assert.equal(headers.cookie, undefined);
      if (method === 'HEAD') return new Response(null, { headers: { 'content-length': '10' } });
      if (headers.range === 'bytes=100-') return new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } });
      assert.equal(headers.range, 'bytes=3-5');
      assert.equal(headers['if-range'], '"etag"');
      return new Response(new Uint8Array([3, 4, 5]), { status: 206, headers: {
        'content-length': '3', 'content-range': 'bytes 3-5/10', 'accept-ranges': 'bytes', 'content-type': 'audio/mp4',
      } });
    },
  });
  const res = await request('/api/audio/track-01', { headers: { range: 'bytes=3-5', 'if-range': '"etag"', cookie: 'private' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('content-range'), 'bytes 3-5/10');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([3, 4, 5]));
  const head = await request('/api/audio/track-01', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  const invalidRange = await request('/api/audio/track-01', { headers: { range: 'bytes=100-' } });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('content-range'), 'bytes */10');
});

test('rejects arbitrary media URLs and does not relay missing songs', async (t) => {
  const request = await fixture(t, {
    saavn: () => Response.json({ data: [{ id: 'track', downloadUrl: [
      { quality: '320kbps', url: 'https://aac.saavncdn.com.example.com/media.mp4' },
    ] }] }),
    fetchMedia: () => assert.fail('should not fetch a disallowed media URL'),
  });
  assert.equal((await request('/api/audio/https%3A%2F%2Fexample.com')).status, 400);
  assert.equal((await request('/api/audio/track?url=https://example.com')).status, 502);
  assert.equal((await request('/api/audio/notfound')).status, 404);
});
