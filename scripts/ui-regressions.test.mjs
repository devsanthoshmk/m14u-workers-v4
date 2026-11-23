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
