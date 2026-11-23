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

function mockRequests(t) {
  state().clearList();
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise((resolve, reject) => {
    requests.push({ url, signal, resolve, reject });
  }));
  return requests;
}

test('list loaders use the configured origin and preserve request and result contracts', async (t) => {
  const requests = mockRequests(t);
  const id = 'test & #?';
  const items = [{ id: 'track', type: 'song' }];
  const album = { id: 'album', name: 'Album', type: 'album' };
  const payload = { name: 'List', items, img: 'img', author: 'Artist', year: '2024', albums: [album] };

  for (const [kind, load, extra] of [
    ['album', () => state().loadAlbum(id), { author: 'Artist', year: '2024' }],
    ['artist', () => state().loadArtist(id), { albums: [album] }],
    ['playlist', () => state().loadPlaylist(id, true), { author: 'Artist' }],
    ['channel', () => state().loadChannel(id), {}],
  ]) {
    const pending = load();
    const request = requests.at(-1);
    const url = new URL(request.url);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, `/api/${kind}`);
    assert.deepEqual(Object.fromEntries(url.searchParams), kind === 'playlist' ? { id, all: 'true' } : { id });
    request.resolve({ ok: true, json: async () => payload });
    await pending;
    assert.deepEqual(state().currentList, { id, type: kind, name: 'List', items, img: 'img', ...extra });
    assert.equal(state().isLoading, false);
    assert.equal(state().error, null);
  }
});

test('playlist preserves the optional continuation flag for capped and complete results', async (t) => {
  const requests = mockRequests(t);
  const items = [{ id: 'track', type: 'song' }];
  for (const hasContinuation of [true, false, undefined]) {
    const pending = state().loadPlaylist('playlist', true);
    const continuation = hasContinuation === undefined ? {} : { hasContinuation };
    requests.at(-1).resolve({ ok: true, json: async () => ({ name: 'Playlist', items, ...continuation }) });
    await pending;
    assert.deepEqual(state().currentList, {
      id: 'playlist', name: 'Playlist', type: 'playlist', items, img: undefined, author: undefined, ...continuation,
    });
  }
});

test('gallery keeps its list shape and exposes the returned artist and playlist entries', async (t) => {
  const [user, related, playlist] = [
    { id: 'user', name: 'User artist', type: 'artist' },
    { id: 'related', name: 'Related artist', type: 'artist' },
    { id: 'playlist', name: 'Related playlist', type: 'playlist' },
  ];
  const requests = mockRequests(t);
  const pending = state().loadGallery(['artist&one', 'artist#two']);
  const [request] = requests;
  assert.equal(request.url, `${origin}/api/gallery?id=artist%26one,artist%23two`);
  request.resolve({ ok: true, json: async () => ({ userArtists: [user], relatedArtists: [related], relatedPlaylists: [playlist] }) });
  await pending;
  assert.deepEqual(state().currentList, {
    id: 'gallery', name: 'Your Library', type: 'playlist', items: [], albums: [user, related, playlist],
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
  requests[2].resolve({ ok: true, json: async () => ({ name: 'Latest playlist' }) });
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
