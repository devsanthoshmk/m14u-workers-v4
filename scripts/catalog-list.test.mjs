import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const origin = 'https://catalog.example.test';
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null, ws: false },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(`${origin}/`) },
});
after(() => server.close());
const { useListStore } = await server.ssrLoadModule('/src/lib/stores/list.ts');
const state = useListStore.getState;
const { searchCatalog, suggestCatalog } = await server.ssrLoadModule('/src/services/catalog.ts');
const success = data => ({ ok: true, json: async () => ({ success: true, data }) });

function mockRequests(t) {
  state().clearList();
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise((resolve, reject) => {
    requests.push({ url, signal, resolve, reject });
  }));
  return requests;
}

test('list loaders use the same origin and normalize raw catalog data', async (t) => {
  const requests = mockRequests(t);
  const id = 'test & #?';
  const songs = [{ id: 'a_B-cD12', name: 'Track', duration: 65 }];
  const album = { id: 'album', name: 'Album' };
  const img = 'https://example.test/list.jpg';
  const payload = { id, name: 'List', songs, topSongs: songs, image: [{ url: img, quality: '500x500' }], artists: { primary: [{ name: 'Artist' }] }, year: 2024, topAlbums: [album] };

  for (const [kind, load, path] of [
    ['album', () => state().loadAlbum(id), '/api/albums'],
    ['artist', () => state().loadArtist(id), `/api/artists/${encodeURIComponent(id)}`],
    ['playlist', () => state().loadPlaylist(id, true), '/api/playlists'],
    ['channel', () => state().loadChannel(id), `/api/artists/${encodeURIComponent(id)}`],
  ]) {
    const pending = load();
    const request = requests.at(-1);
    assert.ok(request.url.startsWith('/api/'));
    const url = new URL(request.url, origin);
    assert.equal(url.pathname, path);
    assert.deepEqual(Object.fromEntries(url.searchParams), kind === 'playlist' ? { id, page: '0', limit: '50' } : kind === 'album' ? { id } : {});
    request.resolve(success(payload));
    await pending;
    const list = state().currentList;
    assert.equal(list.name, 'List');
    assert.equal(list.type, kind);
    assert.equal(list.img, img);
    assert.equal(list.author, 'Artist');
    assert.equal(list.items[0].id, 'a_B-cD12');
    assert.equal(list.items[0].duration, '1:05');
    if (kind === 'artist') assert.deepEqual(list.albums, [{ ...album, img: '', type: 'album' }]);
    assert.equal(state().isLoading, false);
    assert.equal(state().error, null);
  }
});

test('playlist reports continuation and all fetches additional provider pages', async (t) => {
  const requests = mockRequests(t);
  const playlist = { id: 'playlist', name: 'Playlist', songCount: 2 };
  const first = success({ ...playlist, songs: [{ id: 'one', name: 'First' }] });
  const partial = state().loadPlaylist('playlist');
  requests[0].resolve(first);
  await partial;
  assert.equal(state().currentList.hasContinuation, true);

  const pending = state().loadPlaylist('playlist', true);
  requests[1].resolve(first);
  while (requests.length < 3) await Promise.resolve();
  assert.equal(requests[2].url, '/api/playlists?id=playlist&page=1&limit=50');
  requests[2].resolve(success({ ...playlist, songs: [{ id: 'two', name: 'Second' }] }));
  await pending;
  assert.deepEqual(state().currentList.items.map(item => item.id), ['one', 'two']);
  assert.equal(state().currentList.hasContinuation, false);
});

test('gallery derives discovery from Saavn artists and tolerates partial failure', async (t) => {
  const [user, related, album] = [
    { id: 'artist&one', name: 'User artist' },
    { id: 'related', name: 'Related artist' },
    { id: 'album', name: 'Top album' },
  ];
  const requests = mockRequests(t);
  const pending = state().loadGallery(['artist&one', 'artist#two']);
  assert.deepEqual(requests.map(r => r.url), ['/api/artists/artist%26one', '/api/artists/artist%23two']);
  requests[0].resolve(success({ ...user, similarArtists: [related, related], topAlbums: [album] }));
  requests[1].reject(new Error('artist failed'));
  await pending;
  assert.deepEqual(state().currentList, {
    id: 'gallery', name: 'Your Library', type: 'playlist', items: [], albums: [
      { ...user, type: 'artist', img: '' }, { ...related, type: 'artist', img: '' }, { ...album, type: 'album', img: '' },
    ],
  });
});

test('new loads and Clear invalidate previous responses, including pending JSON and errors', async (t) => {
  const requests = mockRequests(t);
  const album = state().loadAlbum('old');
  let resolveBody;
  requests[0].resolve({ ok: true, json: () => new Promise((resolve) => { resolveBody = resolve; }) });
  await Promise.resolve();

  const artist = state().loadArtist('intermediate');
  const playlist = state().loadPlaylist('latest');
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, true);
  requests[1].reject(new Error('stale error'));
  resolveBody({ name: 'Stale album' });
  await Promise.all([album, artist]);
  assert.equal(state().currentList, null);
  assert.equal(state().error, null);
  assert.equal(state().isLoading, true);
  requests[2].resolve(success({ id: 'latest', name: 'Latest playlist' }));
  await playlist;
  assert.equal(state().currentList.name, 'Latest playlist');
  assert.equal(state().isLoading, false);

  for (const finish of [
    (request) => request.resolve({ ok: true, json: async () => ({ name: 'Late channel' }) }),
    (request) => request.reject(new Error('late error')),
  ]) {
    const channel = state().loadChannel('late');
    const request = requests.at(-1);
    state().clearList();
    assert.equal(request.signal.aborted, true);
    assert.equal(state().isLoading, false);
    finish(request);
    await channel;
    assert.equal(state().currentList, null);
    assert.equal(state().error, null);
    assert.equal(state().isLoading, false);
  }
});

test('song search and suggestions use raw Saavn endpoints, preserving playable IDs', async (t) => {
  const requests = mockRequests(t);
  const signal = new AbortController().signal;
  const pending = searchCatalog('one & two', 'song', signal);
  assert.equal(requests[0].url, '/api/search/songs?query=one+%26+two');
  requests[0].resolve(success({ results: [{ id: 'a_B-cD12', name: 'A & B', duration: 142,
    artists: { primary: [{ id: '12', name: 'Artist' }] }, album: { id: '23', name: 'Record' },
    url: 'https://www.jiosaavn.com/song/a-b/a_B-cD12', image: [
      { quality: '500x500', url: 'https://example.test/large' }, { quality: '50x50', url: 'https://example.test/small' },
    ] }] }));
  const [song] = await pending;
  assert.match(song.shareUrl, /^https:\/\/www\.jiosaavn\.com\//);
  assert.equal(song.id, 'a_B-cD12');
  assert.equal(song.videoId, undefined);
  assert.equal(song.authorId, '12');
  assert.equal(song.albumId, '23');
  assert.equal(song.duration, '2:22');
  assert.equal(song.img, 'https://example.test/large');

  const suggest = suggestCatalog('one & two', signal);
  assert.equal(requests[1].url, '/api/search?query=one+%26+two');
  requests[1].resolve(success({ topQuery: { results: [{ title: 'First' }] }, songs: { results: [{ title: 'First' }, { name: 'Second' }] } }));
  assert.deepEqual(await suggest, ['First', 'Second']);
});
