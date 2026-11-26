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

test('music language ranking is bounded, stable, and preserves exact and non-song results', async () => {
    const { rankSongsByLanguage } = await import('../src/lib/utils/musicLanguage.ts');
    const results = [
        { title: 'Another track', type: 'song' },
        { title: 'Exact match', type: 'song', language: 'english' },
        { title: 'Album', type: 'album', language: 'Tamil' },
        { title: 'Preferred', type: 'song', language: 'ta-IN' },
        { title: 'Lower relevance', type: 'song', language: 'Tamil' },
    ];
    assert.deepEqual(rankSongsByLanguage(results, 'tamil', 'exact match'), [results[3], results[1], results[2], results[0], results[4]]);
    assert.equal(rankSongsByLanguage(results, ''), results);
});

test('multi-language ranking applies equal bounded ranking with no cap and preserves relative order', async () => {
    const { rankSongsByLanguage, normalizeMusicLanguages } = await import('../src/lib/utils/musicLanguage.ts');
    assert.deepEqual(normalizeMusicLanguages(['ta-IN', 'Korean', 'ta', 'unknown', 'hi']), ['tamil', 'korean', 'hindi']);
    assert.deepEqual(normalizeMusicLanguages('tamil, telugu, korean'), ['tamil', 'telugu', 'korean']);
    assert.deepEqual(normalizeMusicLanguages(''), []);

    const items = [
        { title: 'Item 0', type: 'song', language: 'french' },
        { title: 'Exact match', type: 'song', language: 'german' },
        { title: 'Item 2 (Korean)', type: 'song', language: 'ko' },
        { title: 'Item 3 (Tamil)', type: 'song', language: 'tamil' },
        { title: 'Item 4 (Album)', type: 'album', language: 'tamil' },
        { title: 'Item 5 (Hindi)', type: 'song', language: 'hindi' },
        { title: 'Item 6 (Telugu)', type: 'song', language: 'telugu' },
        { title: 'Item 7', type: 'song', language: 'spanish' },
    ];
    const ranked = rankSongsByLanguage(items, ['tamil', 'korean'], 'exact match');
    assert.deepEqual(ranked, [
        items[2], // Korean boosted to slot 0
        items[1], // Exact match untouched at index 1
        items[3], // Tamil boosted to slot 2
        items[0], // French moved to slot 3
        items[4], // Album untouched at index 4
        items[5],
        items[6],
        items[7],
    ]);

    // Bounded ranking with no cap across many languages
    const rankedMany = rankSongsByLanguage(items, ['french', 'korean', 'tamil', 'hindi', 'telugu', 'spanish'], 'exact match');
    assert.equal(rankedMany.length, items.length);
    assert.deepEqual(rankSongsByLanguage(items, []), items);
});
const server = await createServer({
    configFile: false,
    define: { 'import.meta.env.VITE_JIOSAAVN_API_URL': JSON.stringify('https://saavn.example.test') },
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
const { useListeningPreferences } = await server.ssrLoadModule('/src/stores/listeningPreferences.ts');
const { matchesCatalog, useCatalogStore } = await server.ssrLoadModule('/src/stores/catalogStore.ts');
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

test('catalog filtering skips saved tracks without usable IDs', () => {
    const ids = [undefined, null, 42, '', 'legacy-youtube-id', 'jiosaavn:track-01'];
    assert.deepEqual(ids.filter(id => matchesCatalog('open-audio', id)), ['legacy-youtube-id']);
    assert.deepEqual(ids.filter(id => matchesCatalog('jiosaavn', id)), ['jiosaavn:track-01']);
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

    const saavnImg = 'https://c.saavncdn.com/343/Voicenotes-English-2018-20190607043050-150x150.jpg';
    assert.deepEqual(trackArtworkUrls({ id: 'jiosaavn:PX3J3pID', img: saavnImg }), [
        'https://c.saavncdn.com/343/Voicenotes-English-2018-20190607043050-500x500.jpg',
        saavnImg,
    ]);
});
const player = usePlayerStore.getState;
const tracks = ['A', 'B', 'C'].map(id => ({ id, title: id, type: 'song' }));
const stream = { adaptiveFormats: [{ type: 'audio/webm', url: 'https://example.test/audio', bitrate: 1 }] };
globalThis.resolveTestStream = async () => stream;

test('web catalog defaults to jiosaavn when no saved preference exists', () => {
    assert.equal(useCatalogStore.getState().provider, 'jiosaavn');
});

test('changing listening language replaces an in-flight search', async (t) => {
    useCatalogStore.getState().choose('open-audio');
    const requests = [];
    t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise(resolve => requests.push({ signal, resolve })));
    const { search, clearSearch } = useSearchStore.getState();
    const { setLanguage } = useListeningPreferences.getState();
    t.after(() => { clearSearch(); setLanguage(''); useCatalogStore.getState().choose('jiosaavn'); });
    const previous = search('music');
    setLanguage('Tamil');
    assert.equal(requests[0].signal.aborted, true);
    const tamil = { ...tracks[1], language: 'ta' };
    requests[1].resolve(Response.json([tracks[0], tamil]));
    requests[0].resolve(Response.json(tracks));
    await previous;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(useSearchStore.getState().results, [tamil, tracks[0]]);
});

test('multi-language preferences manage selection, migration, and search triggering', async (t) => {
    const { setLanguages, setLanguage } = useListeningPreferences.getState();
    t.after(() => { setLanguages([]); });

    setLanguages(['Tamil', 'Telugu']);
    assert.deepEqual(useListeningPreferences.getState().languages, ['tamil', 'telugu']);
    assert.equal(useListeningPreferences.getState().language, 'tamil');

    setLanguage('Hindi');
    assert.deepEqual(useListeningPreferences.getState().languages, ['hindi']);
    assert.equal(useListeningPreferences.getState().language, 'hindi');

    setLanguage('');
    assert.deepEqual(useListeningPreferences.getState().languages, []);
    assert.equal(useListeningPreferences.getState().language, '');
});

test('console API supports musicLanguages multi-select and preserves musicLanguage compatibility', async (t) => {
    globalThis.window = {};
    t.after(() => { delete globalThis.window; });
    registerConsoleAPI();
    const api = window.m14u;
    t.after(() => { api.musicLanguages([]); });

    assert.deepEqual(api.musicLanguages(['tamil', 'korean']), ['tamil', 'korean']);
    assert.deepEqual(api.musicLanguages(), ['tamil', 'korean']);
    assert.equal(api.musicLanguage(), 'tamil');

    assert.equal(api.musicLanguage('telugu'), 'telugu');
    assert.deepEqual(api.musicLanguages(), ['telugu']);

    assert.throws(() => api.musicLanguages(['invalid_lang']), /Unknown listening language/);
    assert.deepEqual(api.musicLanguages([]), []);
    assert.equal(api.musicLanguage(), '');

    assert.equal(api.globalTopFilter('tamil'), 'tamil');
    assert.equal(api.globalTopFilter(), 'tamil');
    assert.equal(api.globalTopFilter('all'), '');
    assert.equal(api.globalTopFilter(), '');
    assert.throws(() => api.globalTopFilter('invalid_lang'), /Unknown listening language/);
});

test('switching providers cancels the previous search and normalizes JioSaavn results', async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise(resolve => requests.push({ url, signal, resolve })));
    const { choose } = useCatalogStore.getState();
    choose('open-audio');
    t.after(() => { choose('jiosaavn'); });
    const state = useSearchStore.getState;
    const previous = state().search('music');
    choose('jiosaavn');
    assert.equal(requests[0].signal.aborted, true);
    assert.deepEqual(state().results, []);
    const next = state().search('music');
    assert.equal(requests[1].url, 'https://saavn.example.test/api/search/songs?query=music');
    assert.match(requests[2].url, /catalog=youtube&f=song$/);
    requests[1].resolve(Response.json({ success: true, data: { results: [{ id: 'track-01', name: 'Song', language: 'Tamil' }] } }));
    await next;
    requests[0].resolve(Response.json(tracks));
    await previous;
    assert.deepEqual(state().results.map(track => track.id), ['jiosaavn:track-01']);
    assert.equal(state().results[0].language, 'tamil');
    choose('open-audio');
    assert.equal(requests[2].signal.aborted, true);
    requests[2].resolve(Response.json([]));
    assert.deepEqual(state().results, []);
    const back = state().search('music');
    assert.match(requests[3].url, /\/api\/search\?q=music$/);
    requests[3].resolve(Response.json(tracks));
    await back;
    assert.deepEqual(state().results, tracks);
});

test('JioSaavn discovery queues only catalog matches and ignores late alternatives after Clear', async (t) => {
    const { choose } = useCatalogStore.getState();
    choose('jiosaavn');
    t.after(() => choose('open-audio'));
    const state = useSearchStore.getState;
    const seed = { id: 'abcdefghijk', title: 'Missing Song', author: 'Singer - Topic' };
    const similar = { id: '12345678901', title: 'Similar Song', author: 'Singer' };
    const saavn = results => Response.json({ success: true, data: { results } });
    let hold = false;
    let useArtistFallback = false;
    let release;
    const available = () => saavn([
        { id: 'wrong', name: similar.title, primaryArtists: 'Other Singer' },
        { id: 'correct', name: similar.title, primaryArtists: similar.author },
    ]);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    t.mock.method(globalThis, 'fetch', async input => {
        const url = new URL(input, 'https://example.test');
        if (url.pathname === '/api/search') return Response.json([seed]);
        if (url.pathname === '/api/up-next') return Response.json(useArtistFallback ? [] : [seed, similar]);
        if (url.searchParams.get('query') === 'Singer') return saavn([
            { id: 'other', name: 'Other Song', primaryArtists: 'Singer' },
            { id: 'unrelated', name: 'Unrelated Song', primaryArtists: 'Other Singer' },
        ]);
        if (url.searchParams.get('query') === 'Similar Song Singer') {
            if (hold) return new Promise(resolve => { release = () => resolve(available()); });
            return available();
        }
        return saavn([]);
    });
    await state().search(seed.title);
    await flush();
    assert.equal(state().discovery.song.title, seed.title);
    assert.deepEqual(state().discovery.alternatives.map(track => track.id), ['jiosaavn:correct']);
    hold = true;
    await state().search(seed.title);
    await flush();
    assert.equal(state().discovery.loading, true);
    state().clearSearch();
    release();
    await flush();
    assert.equal(state().discovery, null);
    assert.deepEqual(state().results, []);
    useArtistFallback = true;
    await state().search(seed.title);
    await flush();
    assert.equal(state().discovery.sameArtist, true);
    assert.deepEqual(state().discovery.alternatives.map(track => track.id), ['jiosaavn:other']);
});

test('catalog views keep saved JioSaavn and Open Audio tracks separate', () => {
    const ids = ['jiosaavn:track-01', 'audius:track-02'];
    assert.deepEqual(ids.filter(id => matchesCatalog('open-audio', id)), ['audius:track-02']);
    assert.deepEqual(ids.filter(id => matchesCatalog('jiosaavn', id)), ['jiosaavn:track-01']);
});

test('search ignores late success and failure, including after Clear', async (t) => {
    useCatalogStore.getState().choose('open-audio');
    t.after(() => { useCatalogStore.getState().choose('jiosaavn'); });
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
    useCatalogStore.getState().choose('open-audio');
    t.after(() => { useCatalogStore.getState().choose('jiosaavn'); });
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
    useCatalogStore.getState().choose('open-audio');
    globalThis.window = {};
    t.after(() => { delete globalThis.window; useCatalogStore.getState().choose('jiosaavn'); });
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
        useCatalogStore.getState().choose('open-audio');
        globalThis.window = {};
        t.after(() => { delete globalThis.window; useCatalogStore.getState().choose('jiosaavn'); });
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

test('Open Audio selection plays first, appends unique recommendations, and ignores a cleared queue', async t => {
    const { playCatalogSelection } = await server.ssrLoadModule('/src/services/catalogPlayback.ts');
    useCatalogStore.getState().choose('open-audio');
    globalThis.resolveTestStream = async () => stream;
    const seed = { ...tracks[0], id: 'audius:seed' };
    const related = { ...tracks[1], id: 'audius:related' };
    const requests = [];
    t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise(resolve => requests.push({ url, signal, resolve })));

    const pending = playCatalogSelection([tracks[2], seed], 1);
    assert.match(requests[0].url, /\/api\/open-recommendations\?id=audius%3Aseed$/);
    assert.equal(player().currentSong.id, seed.id);
    assert.deepEqual(player().queue.map(row => row.song.id), [seed.id]);
    player().addToQueue(tracks[2]);
    requests[0].resolve(Response.json([seed, related, related]));
    await pending;
    assert.deepEqual(player().queue.map(row => row.song.id), [seed.id, tracks[2].id, related.id]);

    const jamendo = { ...tracks[2], id: 'openverse:f102eb5d-b008-4a74-aa3d-1120fba29d08' };
    const excluded = { ...tracks[1], id: 'freetouse:excluded' };
    const fallback = playCatalogSelection([seed, excluded, jamendo, jamendo], 0);
    requests[1].resolve(Response.json([]));
    await fallback;
    assert.deepEqual(player().queue.map(row => row.song.id), [seed.id, jamendo.id]);

    const stale = playCatalogSelection([seed], 0);
    player().clearQueue();
    assert.equal(requests[2].signal.aborted, true);
    requests[2].resolve(Response.json([related]));
    await stale;
    assert.deepEqual(player().queue, []);
});

test('JioSaavn catalog queues collapse compilation copies without replacing the selected release', async () => {
    globalThis.resolveTestStream = async () => stream;
    const attention = { ...tracks[0], id: 'jiosaavn:attention', title: 'Attention', author: 'Charlie Puth' };
    const duplicateSeed = { ...attention, id: 'jiosaavn:attention-copy' };
    const floor = { ...tracks[1], id: 'jiosaavn:floor', title: 'On The Floor', author: 'Jennifer Lopez, Pitbull' };
    const copies = Array.from({ length: 22 }, (_, i) => ({ ...floor, id: `jiosaavn:compilation-${i}`, author: 'Pitbull, Jennifer Lopez' }));
    const list = [duplicateSeed, attention, floor, ...copies];
    await player().setQueue(list, 1);
    assert.equal(player().currentSong.id, attention.id);
    assert.equal(player().queueIndex, 0);
    assert.deepEqual(player().queue.map(row => row.song.id), [attention.id, floor.id]);

    await player().setQueue(list, 0, true);
    assert.deepEqual(player().originalQueue.map(row => row.song.id), [duplicateSeed.id, floor.id]);
    assert.equal(player().queue.length, 2);
    player().clearQueue();
});

test('JioSaavn refills only near the queue end and cancels on Clear', async t => {
    const { startSaavnQueue } = await server.ssrLoadModule('/src/services/saavnQueue.ts');
    useCatalogStore.getState().choose('jiosaavn');
    globalThis.resolveTestStream = async () => stream;
    const make = n => ({ id: `jiosaavn:s${n}`, title: `Song ${n}`, author: 'Artist', type: 'song' });
    const requests = [];
    t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise(resolve => requests.push({ url, signal, resolve })));
    const initial = startSaavnQueue(make(0));
    requests[0].resolve(Response.json([
        { ...make(0), id: 'jiosaavn:seed-copy' },
        make(1), { ...make(1), id: 'jiosaavn:compilation-copy' },
        ...Array.from({ length: 7 }, (_, i) => make(i + 2)),
    ]));
    await initial;
    assert.deepEqual(player().queue.map(row => row.song.id), Array.from({ length: 9 }, (_, i) => make(i).id));
    await player().playFromQueue(4);
    assert.equal(requests.length, 1);
    await player().playFromQueue(5);
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /id=s5/);
    assert.match(requests[1].url, /exclude=song\+1%7Cartist/);
    requests[1].resolve(Response.json([{ ...make(0), id: 'jiosaavn:copy', title: 'Song 0 (From "Scene")', author: 'Guest, Artist' }, make(9)]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(player().queue.at(-1).song.id, 'jiosaavn:s9');
    assert.equal(player().queue.length, 10);
    await player().playFromQueue(6);
    player().clearQueue();
    assert.equal(requests[2].signal.aborted, true);
    requests[2].resolve(Response.json([make(10)]));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(player().queue, []);
    useCatalogStore.getState().choose('open-audio');
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

test('catalog settings modal can be opened and closed', () => {
    useCatalogStore.getState().openSettings();
    assert.equal(useCatalogStore.getState().dialog, 'settings');
    useCatalogStore.getState().closeDialog();
    assert.equal(useCatalogStore.getState().dialog, null);
});

test('panel widths clamp to bounds and reset via store and console API', async (t) => {
    const { useUIStore, PANEL_WIDTHS } = await server.ssrLoadModule('/src/stores/uiStore.ts');
    globalThis.window = {};
    t.after(() => { delete globalThis.window; });
    registerConsoleAPI();
    const api = window.m14u;

    assert.equal(api.panels.setSidebarWidth(100), PANEL_WIDTHS.SIDEBAR_MIN);
    assert.equal(api.panels.setSidebarWidth(999), PANEL_WIDTHS.SIDEBAR_MAX);
    assert.equal(api.panels.setSidebarWidth(260), 260);

    assert.equal(api.panels.setRightPanelWidth(100), PANEL_WIDTHS.RIGHT_MIN);
    assert.equal(api.panels.setRightPanelWidth(999), PANEL_WIDTHS.RIGHT_MAX);
    assert.equal(api.panels.setRightPanelWidth(420), 420);

    assert.deepEqual(api.panels.state(), {
        queue: useUIStore.getState().isQueueOpen,
        lyrics: useUIStore.getState().isLyricsOpen,
        sidebar: useUIStore.getState().isSidebarOpen,
        sidebarWidth: 260,
        rightPanelWidth: 420,
    });

    assert.deepEqual(api.panels.resetWidths(), {
        sidebarWidth: PANEL_WIDTHS.SIDEBAR_DEFAULT,
        rightPanelWidth: PANEL_WIDTHS.RIGHT_DEFAULT,
    });
});
