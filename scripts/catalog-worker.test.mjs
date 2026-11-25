import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { Innertube, YTNodes } from 'youtubei.js';

const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, ws: false },
});
after(() => server.close());
const { default: worker } = await server.ssrLoadModule('/src/backend/worker.ts');

const request = (path, method = 'GET', env = { LASTFM_API_KEY: 'mock-test-key' }) =>
  worker.fetch({ url: `https://catalog.example.test/api/${path}`, method }, env);

beforeEach(t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected outbound fetch'); });
  t.mock.method(Innertube, 'create', () => { throw new Error('Unexpected Innertube setup'); });
});

test('up-next validates the seed and returns only distinct recommendation identities', async t => {
  assert.equal((await request('up-next?id=invalid')).status, 400);
  const seed = 'abcdefghijk';
  const video = (id, title) => Object.assign(Object.create(YTNodes.PlaylistPanelVideo.prototype), {
    type: YTNodes.PlaylistPanelVideo.type, video_id: id, title, author: 'Singer',
  });
  t.mock.method(Innertube, 'create', async () => ({ music: { async getUpNext(id) {
    assert.equal(id, seed);
    return { contents: [video(seed, 'Seed'), video('12345678901', 'Similar'), video('12345678901', 'Duplicate')] };
  } } }));
  const response = await request(`up-next?id=${seed}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: '12345678901', title: 'Similar', author: 'Singer' }]);
});

test('JioSaavn recommendations exclude other releases of the seed and duplicate songs', async t => {
  const song = (id, name, artist = 'Sabrina Carpenter') => ({ id, name, artists: { primary: [{ name: artist }] } });
  t.mock.method(globalThis, 'fetch', async input => {
    assert.equal(new URL(input).searchParams.get('query'), 'Sabrina Carpenter');
    return Response.json({ success: true, data: { results: [song('copy', 'Espresso (From “Soundtrack”)'), song('one', 'Taste (From "Soundtrack")'),
      song('copy2', 'TASTE'), song('other', 'Unrelated', 'Another Artist'), song('two', 'Please Please Please'), song('live', 'Taste (Live)')] } });
  });
  const response = await request('saavn-recommendations?id=seed&title=Espresso&artist=Sabrina+Carpenter');
  assert.deepEqual((await response.json()).map(song => song.id), ['jiosaavn:one', 'jiosaavn:two', 'jiosaavn:live']);
  const refill = await request('saavn-recommendations?id=seed&title=Espresso&artist=Sabrina+Carpenter&exclude=taste%7Csabrina+carpenter');
  assert.deepEqual((await refill.json()).map(song => song.id), ['jiosaavn:two', 'jiosaavn:live']);
});

test('YouTube mode skips open discovery on an Open Audio deployment', async () => {
  const result = await request('search-discovery?catalog=youtube', 'GET', { MUSIC_CATALOG: 'open' });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { openCatalog: false, tracks: [] });
});

test('Open Audio queues only relevant, eligible tracks and tolerates a provider failure', async t => {
  const track = (id, fields = {}) => ({ id, title: `Track ${id}`, permalink: `/artist/${id}`, duration: 180,
    license: 'CC0', is_streamable: true, access: { stream: true }, user: { id: 'owner', name: 'Artist' }, ...fields });
  const seed = track('seed', { tags: 'lo-fi' });
  t.mock.method(globalThis, 'fetch', async input => {
    const { hostname, pathname } = new URL(input);
    if (hostname === 'api.openverse.org') return new Response(null, { status: 429 });
    assert.equal(hostname, 'api.audius.co');
    switch (pathname) {
      case '/v1/tracks/seed': return Response.json({ data: seed });
      case '/v1/tracks/seed/remixes': return Response.json({ data: { tracks: [track('mix'), track('gated', { access: { stream: false } })] } });
      case '/v1/tracks/seed/remixing': return Response.json({ data: [] });
      case '/v1/users/owner/tracks': return Response.json({ data: [seed, track('same'), track('mix')] });
      case '/v1/tracks/search': return Response.json({ data: [track('related', { tags: 'lo-fi', user: { id: 'other', name: 'Other Artist' } }),
        track('irrelevant', { tags: 'metal', user: { id: 'someone', name: 'Someone' } })] });
      default: throw new Error(`Unexpected provider path: ${pathname}`);
    }
  });
  const env = { MUSIC_CATALOG: 'open' };
  const response = await request('open-recommendations?id=audius:seed', 'GET', env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const tracks = await response.json();
  assert.deepEqual(tracks.map(item => item.id), ['audius:mix', 'audius:same', 'audius:related']);
  assert.ok(tracks.every(item => !('url' in item) && !('adaptiveFormats' in item)));
  assert.deepEqual(await (await request('open-recommendations?id=freetouse:excluded', 'GET', env)).json(), []);
});

test('open search resolves the exact public MP3 with artwork, without Innertube', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    calls.push(url.pathname);
    assert.equal(url.origin, 'https://archive.org');
    if (url.pathname === '/advancedsearch.php') {
      assert.match(url.searchParams.get('q'), /title:"test"/);
      return Response.json({ response: { docs: [{ identifier: 'open-album', title: 'Test album' }] } });
    }
    assert.equal(url.pathname, '/metadata/open-album');
    return Response.json({
      metadata: { mediatype: 'audio', licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/', creator: 'Open Artist' },
      files: [
        { name: 'disc one/Track #1.mp3', title: 'Track One', length: '65.5' },
        { name: 'private.mp3', private: 'true' },
        { name: '../escape.mp3' },
        { name: 'notes.pdf' },
      ],
    });
  });
  const env = { MUSIC_CATALOG: 'archive' };
  const search = await request('search?q=test', 'GET', env);
  assert.equal(search.status, 200);
  const tracks = await search.json();
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, 'Track One');
  assert.equal(tracks[0].duration, '1:05');
  assert.equal(tracks[0].img, 'https://archive.org/services/img/open-album');
  const stream = await request(`stream?${new URLSearchParams({ id: tracks[0].id })}`, 'GET', env);
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('Cache-Control'), 'no-store');
  const details = await stream.json();
  assert.equal(details.sourceUrl, 'https://archive.org/details/open-album');
  assert.equal(details.adaptiveFormats[0].url, 'https://archive.org/download/open-album/disc%20one/Track%20%231.mp3');
  const missing = await request('stream?id=archive:open-album:private.mp3', 'GET', env);
  assert.equal(missing.status, 404);
  const invalid = await request('stream?id=archive:evil.example:..%252Fescape.mp3', 'GET', env);
  assert.equal(invalid.status, 404);
  assert.equal(calls.length, 4);
});

test('stream rechecks Archive rights instead of trusting a track ID', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    metadata: { mediatype: 'audio', licenseurl: 'https://unrelated.example/publicdomain/zero/1.0/' },
    files: [{ name: 'track.mp3' }],
  }));
  const response = await request('stream?id=archive:item:track.mp3');
  assert.equal(response.status, 404);
});

test('song search skips broad archives, survives an outage and preserves saved Commons playback', async t => {
  const audius = { id: 'aBc', title: 'Open Song', permalink: '/artist/open-song', license: 'Attribution CC BY',
    is_streamable: true, access: { stream: true } };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    calls.push(url.hostname);
    if (url.hostname === 'api.openverse.org') {
      assert.equal(url.searchParams.get('category'), 'music');
      return Response.json({ results: [] });
    }
    if (url.hostname === 'api.freetouse.com') return new Response(null, { status: 503 });
    if (url.hostname === 'commons.wikimedia.org') return Response.json({ query: { pages: [{
      pageid: 42, title: 'File:Piano.oga', imageinfo: [{ mime: 'application/ogg', url: 'https://upload.wikimedia.org/test.oga',
        extmetadata: { LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }],
    }] } });
    assert.equal(url.hostname, 'api.audius.co');
    return Response.json({ data: url.pathname.endsWith('/search')
      ? [audius, { ...audius, id: 'private', access: { stream: false } }] : audius });
  });
  const search = await request('search?q=piano', 'GET', { MUSIC_CATALOG: 'open' });
  assert.equal(search.headers.get('Cache-Control'), 'no-store');
  const results = await search.json();
  assert.deepEqual(results.map(track => track.id), ['audius:aBc']);
  assert.ok(!calls.includes('archive.org') && !calls.includes('commons.wikimedia.org'));
  assert.ok(results.every(track => !('url' in track)));
  const commons = await (await request('stream?id=commons:42')).json();
  assert.equal(commons.adaptiveFormats[0].type, 'audio/ogg');
  const audio = await (await request('stream?id=audius:aBc')).json();
  assert.equal(audio.adaptiveFormats[0].url, 'https://api.audius.co/v1/tracks/aBc/stream');
});

test('local validation, not found and CORS preflight keep their contracts', async () => {
  const invalid = await request('search');
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Missing q parameter' });
  const missing = await request('nonexistent');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not Found' });
  const preflight = await request('search', 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
});

test('provider errors that look like validation errors do not leak into responses or logs', async (t) => {
  t.mock.method(Innertube, 'create', async () => { throw new Error('Missing token: do-not-echo'); });
  const log = t.mock.method(console, 'error', () => {});
  const res = await request('album?id=test');
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'Catalog operation failed' });
  assert.deepEqual(log.mock.calls.map(call => call.arguments), [[{ event: 'catalog_request_failed', route: 'album', status: 500 }]]);
});

function mockTimeouts(t) {
  const timers = [];
  t.mock.method(AbortSignal, 'timeout', delay => {
    const controller = new AbortController();
    timers.push({ delay, controller });
    return controller.signal;
  });
  return timers;
}

test('headers timeout aborts provider I/O and returns a safe 504', async (t) => {
  const timers = mockTimeouts(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(Innertube, 'create', async ({ fetch }) => ({ search: () => fetch('https://upstream.example.test') }));
  let started;
  const didStart = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    started(signal);
  }));
  const pending = request('search?q=stall&f=playlist');
  const signal = await didStart;
  assert.deepEqual(timers.map(timer => timer.delay), [15_000, 5_000]);
  timers[1].controller.abort(new DOMException('private provider URL', 'TimeoutError'));
  assert.equal(signal.aborted, true);
  const res = await pending;
  assert.equal(res.status, 504);
  assert.deepEqual(await res.json(), { error: 'Catalog provider timed out' });
});

test('catalog deadline cancels a batch without launching queued lookups', async (t) => {
  const timers = mockTimeouts(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(Innertube, 'create', async ({ fetch }) => ({ music: { getArtist: () => fetch('https://upstream.example.test') } }));
  const signals = [];
  let started;
  const didStart = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_, reject) => {
    signals.push(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    if (signals.length === 3) started();
  }));
  const pending = request('gallery?id=a,b,c,d,e');
  await didStart;
  timers[0].controller.abort();
  const res = await pending;
  assert.equal(res.status, 504);
  assert.equal(signals.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
});

test('a provider attempt includes consumption of its response body', async (t) => {
  const timers = mockTimeouts(t);
  t.mock.method(console, 'error', () => {});
  let reading;
  const didRead = new Promise(resolve => { reading = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
    pull() { reading(); },
  }, { highWaterMark: 0 })));
  const pending = request('similar?title=test&artist=test');
  await didRead;
  timers[1].controller.abort(new DOMException('private response metadata', 'TimeoutError'));
  const res = await pending;
  assert.equal(res.status, 504);
  assert.deepEqual(await res.json(), { error: 'Catalog provider timed out' });
});

for (const route of ['gallery', 'subfeed']) {
  test(`${route} serves partial results without caching after an individual timeout`, async (t) => {
    const timers = mockTimeouts(t);
    t.mock.method(console, 'warn', () => {});
    const video = {
      is: type => type === YTNodes.Video,
      as: () => ({ id: 'video', title: 'Video', author: { name: 'Author' }, view_count: '10 views', duration: { text: '3:00', seconds: 180 } }),
    };
    t.mock.method(Innertube, 'create', async ({ fetch }) => {
      const check = id => id === 'slow' ? fetch('https://upstream.example.test') : Promise.resolve();
      return {
        music: { getArtist: async id => { await check(id); return {}; } },
        getChannel: async id => ({ metadata: { title: 'Channel' }, getVideos: async () => {
          await check(id);
          return { videos: [video] };
        } }),
      };
    });
    let started;
    const didStart = new Promise(resolve => { started = resolve; });
    t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started();
    }));

    const pending = request(`${route}?id=ok,slow`);
    await didStart;
    timers[1].controller.abort(new DOMException('timed out', 'TimeoutError'));
    const partial = await pending;
    const healthy = await request(`${route}?id=ok`);
    assert.equal(partial.status, 200);
    assert.equal(partial.headers.get('Cache-Control'), 'no-store');
    assert.equal(healthy.headers.get('Cache-Control'), 's-maxage=86400, stale-while-revalidate=3600');
    const partialBody = await partial.json();
    assert.deepEqual(partialBody, await healthy.json());
    assert.equal(route === 'gallery' ? partialBody.userArtists[0].id : partialBody[0].authorId, 'ok');
  });
}

test('gallery preserves input order within its ID and concurrency caps', async (t) => {
  const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);
  let active = 0;
  let peak = 0;
  t.mock.method(Innertube, 'create', async () => ({ music: { getArtist: async () => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return {};
  } } }));
  const res = await request(`gallery?id=${ids.join(',')}`);
  assert.equal(res.status, 200);
  assert.equal(peak, 3);
  assert.deepEqual(await res.json(), {
    userArtists: ids.slice(0, 12).map(id => ({ id, name: '', img: '', type: 'artist' })),
    relatedArtists: [],
    relatedPlaylists: [],
  });
});

test('similar limits both the upstream query and the subsequent track lookups', async (t) => {
  const tracks = Array.from({ length: 20 }, (_, i) => ({ name: `Track ${i}`, artist: { name: 'Artist' } }));
  const provider = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url.hostname, 'ws.audioscrobbler.com');
    assert.equal(url.searchParams.get('limit'), '15');
    return Response.json({ similartracks: { track: tracks } });
  });
  const queries = [];
  t.mock.method(Innertube, 'create', async () => ({ music: { search: async query => { queries.push(query); return {}; } } }));
  const res = await request('similar?title=test&artist=test&limit=9999');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
  assert.equal(provider.mock.callCount(), 1);
  assert.deepEqual(queries, tracks.slice(0, 15).map(track => `${track.name} Artist`));
});

test('similar returns empty fallback when provider credential is not configured', async () => {
  const res = await worker.fetch({ url: 'https://catalog.example.test/api/similar?title=test&artist=test', method: 'GET' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('playlist continuation stops at its page budget and preserves payload and flags', async (t) => {
  let pages = 0;
  const title = { toString: () => 'Video' };
  const playlist = () => ({
    info: { title: 'Playlist', author: { name: 'Author' } },
    has_continuation: true,
    getContinuation: async () => { pages++; return playlist(); },
    items: [{
      is: type => type === YTNodes.PlaylistVideo,
      as: () => ({ id: `${pages}`, title, author: { name: 'Name', id: 'channel' }, duration: { text: '3:00' } }),
    }],
  });
  t.mock.method(Innertube, 'create', async () => ({ getPlaylist: async () => playlist() }));
  const first = await request('playlist?id=PL');
  assert.deepEqual(await first.json(), {
    id: 'PL', name: 'Playlist', author: 'Author', img: '', type: 'playlist', hasContinuation: true,
    items: [{ id: '0', title: 'Video', author: 'Name', authorId: 'channel', duration: '03:00', subtext: '', type: 'video' }],
  });
  assert.equal(pages, 0);
  const all = await request('playlist?id=PL&all=true');
  assert.equal(all.status, 200);
  const body = await all.json();
  assert.equal(pages, 12);
  assert.equal(body.hasContinuation, true);
  assert.deepEqual(body.items.map(item => item.id), Array.from({ length: 13 }, (_, i) => String(i)));
});
