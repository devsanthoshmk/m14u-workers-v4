import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const origin = 'http://localhost';
const audioHeaders = ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified'];
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}));

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function fail(res, status, message) {
  json(res, status, { success: false, message });
}

function preferredAudio(song) {
  const formats = Array.isArray(song?.downloadUrl) ? song.downloadUrl : [];
  return formats
    .map(({ url, quality }) => ({ url: URL.parse(url), bitrate: Number.parseInt(quality, 10) || 0 }))
    .filter(({ url }) => url?.protocol === 'https:' && url.hostname === 'aac.saavncdn.com' &&
      !url.username && !url.password && !url.port)
    .sort((a, b) => b.bitrate - a.bitrate)[0]?.url;
}

async function relayAudio({ req, res, id, saavn, fetchMedia, signal }) {
  // Only resolve catalog IDs: never forward a caller-supplied media URL or follow CDN redirects.
  if (!/^[\w-]{1,64}$/.test(id)) return fail(res, 400, 'Invalid song ID');
  const lookup = new URL('/api/songs', origin);
  lookup.searchParams.set('ids', id);
  const result = await saavn(new Request(lookup, { signal }));
  if (result.status === 404) return fail(res, 404, 'Song not found');
  if (!result.ok) return fail(res, 502, 'Song lookup failed');
  const { data } = await result.json();
  const song = Array.isArray(data) && data.find((item) => item.id === id);
  if (!song) return fail(res, 404, 'Song not found');
  const media = preferredAudio(song);
  if (!media) return fail(res, 502, 'No playable audio URL');

  const headers = { 'accept-encoding': 'identity' };
  for (const name of ['range', 'if-range']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const upstream = await fetchMedia(media, { method: req.method, redirect: 'error', headers, signal });
  if (![200, 206, 416].includes(upstream.status) ||
      (upstream.headers.has('content-encoding') && upstream.headers.get('content-encoding') !== 'identity')) {
    await upstream.body?.cancel();
    return fail(res, 502, 'Audio CDN unavailable');
  }
  for (const name of audioHeaders) {
    if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name));
  }
  res.statusCode = upstream.status;
  if (req.method === 'HEAD' || !upstream.body) return res.end();
  await pipeline(upstream.body, res, { signal });
}

async function serveStatic(req, res, dist, pathname, signal) {
  let file = resolve(dist, `.${pathname}`);
  if (file !== dist && !file.startsWith(`${dist}${sep}`)) return fail(res, 404, 'Not found');
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    // Missing assets should not receive the SPA shell with a successful status.
    if (extname(pathname) || pathname === '/assets' || pathname.startsWith('/assets/')) {
      return fail(res, 404, 'Not found');
    }
    file = resolve(dist, 'index.html');
    info = await stat(file);
  }
  res.setHeader('content-type', types.get(extname(file)) ?? 'application/octet-stream');
  res.setHeader('content-length', info.size);
  res.setHeader('cache-control', file.startsWith(`${dist}${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(file), res, { signal });
}

export function createWebServer({ dist, saavn, fetchMedia = fetch }) {
  dist = dist ? resolve(dist) : null;
  return createServer(async (req, res) => {
    const disconnect = new AbortController();
    res.once('close', () => disconnect.abort());
    res.setHeader('x-content-type-options', 'nosniff');
    let api = false;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD');
        return fail(res, 405, 'Method not allowed');
      }
      // Parse the origin-form target without trusting Host or Forwarded headers.
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return fail(res, 400, 'Invalid request URL');
      const url = new URL(`${origin}${req.url}`);
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return fail(res, 400, 'Invalid request path');
      }
      if (pathname === '/healthz') return json(res, 200, { ok: true });
      api = pathname === '/api' || pathname.startsWith('/api/');
      if (!api) return dist ? await serveStatic(req, res, dist, pathname, disconnect.signal) : fail(res, 404, 'Not found');
      res.setHeader('access-control-allow-origin', '*');

      if (pathname === '/api/audio' || pathname.startsWith('/api/audio/')) {
        return await relayAudio({ req, res, id: pathname.slice('/api/audio/'.length), saavn, fetchMedia,
          signal: AbortSignal.any([disconnect.signal, AbortSignal.timeout(120_000)]) });
      }
      const response = await saavn(new Request(url, { method: req.method, signal: disconnect.signal }));
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'access-control-allow-origin': '*' });
      if (req.method === 'HEAD' || !response.body) return res.end();
      await pipeline(response.body, res, { signal: disconnect.signal });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy(error);
      console.error(error);
      fail(res, api ? 502 : 500, api ? 'Upstream unavailable' : 'Server error');
    }
  });
}
