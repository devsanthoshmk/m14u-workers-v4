import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

class FakeAudio extends EventTarget {
    src = '';
    currentTime = 0;
    paused = true;
    played = { length: 0 };
    getAttribute() { return this.src || null; }
    removeAttribute() { this.src = ''; }
    load() { this.played = { length: 0 }; }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
}

globalThis.Audio = FakeAudio;
globalThis.document = { activeElement: null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null, ws: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    plugins: [{
        name: 'stub-stream-provider',
        enforce: 'pre',
        transform: (code, id) => id.endsWith('/src/stores/playerStore.ts')
            ? code.replace("'@/lib/modules/getStreamData'", "'virtual:stub-stream'") : undefined,
        resolveId: id => id === 'virtual:stub-stream' ? '\0stub-stream' : undefined,
        load: id => id === '\0stub-stream'
            ? 'export default (...args) => globalThis.resolveTestStream(...args); export function prefetchNextSong() {}'
            : undefined,
    }],
});
after(() => server.close());
const { useSearchStore } = await server.ssrLoadModule('/src/lib/stores/search.ts');
const { usePlayerStore } = await server.ssrLoadModule('/src/stores/playerStore.ts');
const { registerConsoleAPI } = await server.ssrLoadModule('/src/lib/testing/console-api.ts');
const { trackArtworkUrls } = await server.ssrLoadModule('/src/utils/trackArtwork.ts');
const { toTrackItem, trackDurationSeconds } = await server.ssrLoadModule('/src/utils/trackMetadata.ts');

test('track metadata normalizes legacy IDs and preserves catalog duration labels', () => {
    const legacy = { type: 'SONG', videoId: 'legacy', name: 'Track', artist: { name: 'Artist', artistId: 'artist' }, duration: 63 };
    const track = toTrackItem(legacy);
    assert.equal(track.id, 'legacy');
    assert.equal(track.title, 'Track');
    assert.equal(track.duration, '1:03');
    assert.equal(trackDurationSeconds(track), 63);
    const catalog = { type: 'song', id: 'catalog', duration: '1:02:03' };
    assert.equal(toTrackItem(catalog), catalog);
    assert.equal(trackDurationSeconds(catalog), 3723);
    assert.equal(trackDurationSeconds({ ...catalog, duration: '2M views' }), undefined);
});

test('media artwork prefers a full-size cover and keeps fallbacks', () => {
    const img = 'https://lh3.googleusercontent.com/cover=w60-h60-l90-rj';
    const largest = 'https://example.test/large.jpg';
    const urls = trackArtworkUrls({ id: 'dQw4w9WgXcQ', img, thumbnails: [
        { url: img, width: 60 }, { url: largest, width: 800 },
    ] });
    assert.deepEqual(urls.slice(0, 3), [
        'https://lh3.googleusercontent.com/cover=w800-h800', largest,
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    ]);
    assert.equal(urls.at(-1), img);
    assert.equal(urls.filter(url => url === img).length, 1);
});
const player = usePlayerStore.getState;
const tracks = ['A', 'B', 'C'].map(id => ({ id, title: id, type: 'song' }));
const stream = { adaptiveFormats: [{ type: 'audio/webm', url: 'https://example.test/audio', bitrate: 1 }] };
globalThis.resolveTestStream = async () => stream;

test('search ignores late success and failure, including after Clear', async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', () => new Promise((resolve, reject) => requests.push({ resolve, reject })));
    const state = useSearchStore.getState;
    const old = state().search('old');
    const latest = state().search('latest');
    requests[1].resolve(Response.json(tracks));
    await latest;
    requests[0].reject(new Error('old request failed'));
    await old;
    assert.deepEqual(state().results, tracks);
    assert.equal(state().error, null);
    const pending = state().search('clear me');
    state().clearSearch();
    requests[2].resolve(Response.json(tracks));
    await pending;
    assert.deepEqual(state().results, []);
    assert.equal(state().isLoading, false);
});

test('suggestions ignore stale failures and responses after Clear', async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', () => new Promise((resolve, reject) => requests.push({ resolve, reject })));
    const state = useSearchStore.getState;
    const stale = state().getSuggestions('a');
    const latest = state().getSuggestions('ab');
    requests[1].resolve(Response.json(['abc']));
    await latest;
    requests[0].reject(new Error('old request failed'));
    await stale;
    assert.deepEqual(state().suggestions, ['abc']);
    const cleared = state().getSuggestions('abc');
    state().clearSearch();
    requests[2].resolve(Response.json(['abcd']));
    await cleared;
    assert.deepEqual(state().suggestions, []);
});

test('console play uses only its own current search results across overlaps and Clear', async (t) => {
    globalThis.window = {};
    t.after(() => { delete globalThis.window; });
    registerConsoleAPI();
    const api = window.m14u;
    const played = [];
    t.mock.method(player(), 'playSong', async track => { played.push(track.id); });
    const requests = [];
    t.mock.method(globalThis, 'fetch', () => new Promise(resolve => requests.push(resolve)));

    const old = api.play('same query');
    const oldRejected = assert.rejects(old, /play: no song found for "same query"/);
    const latest = api.play('same query');
    requests[1](Response.json([{ type: 'album', id: 'album' }, tracks[1]]));
    await latest;
    requests[0](Response.json([tracks[0]]));
    await oldRejected;
    assert.deepEqual(played, ['B']);

    const cleared = api.play('clear me');
    const clearedRejected = assert.rejects(cleared, /play: no song found for "clear me"/);
    api.clearSearch();
    const fresh = api.search('fresh');
    requests[3](Response.json([tracks[2]]));
    await fresh;
    requests[2](Response.json([tracks[0]]));
    await clearedRejected;
    assert.deepEqual(played, ['B']);
    assert.deepEqual(useSearchStore.getState().results, [tracks[2]]);
});

for (const [command, payload, expected] of [
    ['search', [tracks[1]], [{ id: 'B', title: 'B', author: undefined, duration: undefined }]],
    ['suggest', ['latest suggestion'], ['latest suggestion']],
]) {
    test(`console ${command} returns only its own results across overlap and Clear`, async (t) => {
        globalThis.window = {};
        t.after(() => { delete globalThis.window; });
        registerConsoleAPI();
        const api = window.m14u;
        const requests = [];
        t.mock.method(globalThis, 'fetch', () => new Promise(resolve => requests.push(resolve)));

        const stale = api[command]('same query');
        const latest = api[command]('same query');
        requests[1](Response.json(payload));
        assert.deepEqual(await latest, expected);
        requests[0](Response.json(payload));
        assert.deepEqual(await stale, []);

        const cleared = api[command]('clear me');
        api.clearSearch();
        const fresh = api[command]('fresh');
        requests[3](Response.json(payload));
        assert.deepEqual(await fresh, expected);
        requests[2](Response.json(payload));
        assert.deepEqual(await cleared, []);
    });
}

test('Clear cancels pending stream resolution and permits a fresh selection', async () => {
    let complete;
    globalThis.resolveTestStream = () => new Promise(resolve => { complete = resolve; });
    const pending = player().setQueue(tracks);
    player().clearQueue();
    complete(stream);
    await pending;
    assert.equal(player().currentSong, null);
    assert.equal(player().audio.src, '');
    assert.equal(player().isBuffering, false);
    globalThis.resolveTestStream = async () => stream;
    await player().setQueue(tracks, 1);
    assert.equal(player().currentSong.id, 'B');
    assert.equal(player().audio.paused, false);
});

test('queue protects active rows, clears a sole active row, and shuffles before playing', async (t) => {
    for (const index of [0, 1, 2]) {
        await player().setQueue(tracks, index);
        player().removeFromQueue(player().queue[index].queueId);
        assert.equal(player().queueIndex, index);
        assert.equal(player().queue.length, 3);
        assert.equal(player().currentSong.id, tracks[index].id);
    }
    await player().setQueue([tracks[0]]);
    player().removeFromQueue(player().queue[0].queueId);
    assert.equal(player().currentSong, null);
    t.mock.method(Math, 'random', () => 0);
    await player().setQueue(tracks, 0, true);
    assert.notEqual(player().currentSong.id, 'A');
    assert.deepEqual(player().queue.map(item => item.song.id).sort(), ['A', 'B', 'C']);
    await player().setQueue(tracks);
    assert.deepEqual(player().queue.map(item => item.song.id), ['A', 'B', 'C']);
});

test('end-of-song stops before repeat or advance, and history records once', async () => {
    await player().setQueue(tracks);
    const audio = player().audio;
    audio.played = { length: 1, start: () => 0, end: () => 6 };
    audio.dispatchEvent(new Event('timeupdate'));
    const entry = player().listeningHistory[0];
    assert.equal(entry.song.id, 'A');
    assert.equal(entry.listenedDuration, 6);
    player().setRepeatMode('one');
    player().startSleepTimer('end_of_song');
    player()._onTrackEnded();
    assert.equal(audio.paused, true);
    assert.equal(player().queueIndex, 0);
    assert.equal(player().sleepTimer.isActive, false);
    assert.equal(player().listeningHistory[0], entry);
    await player().next();
    assert.equal(player().currentSong.id, 'B');
});
