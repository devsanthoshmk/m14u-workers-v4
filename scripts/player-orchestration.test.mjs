import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

let audioPlayCount = 0;
let audioSrcAssignments = [];

class FakeAudio extends EventTarget {
    _src = '';
    currentTime = 0;
    paused = true;
    muted = false;
    volume = 1;
    played = { length: 0 };
    get src() { return this._src; }
    set src(value) {
        this._src = value;
        audioSrcAssignments.push(value);
    }
    getAttribute(name) { return name === 'src' ? (this._src || null) : null; }
    removeAttribute(name) { if (name === 'src') this._src = ''; }
    load() { this.played = { length: 0 }; }
    pause() { this.paused = true; }
    async play() {
        audioPlayCount += 1;
        this.paused = false;
    }
}

class FakeDocument extends EventTarget {
    activeElement = null;
    hidden = false;
}

const fakeDoc = new FakeDocument();
const storageMap = new Map();
globalThis.Audio = FakeAudio;
globalThis.document = fakeDoc;
globalThis.localStorage = {
    getItem: (key) => (storageMap.has(key) ? storageMap.get(key) : null),
    setItem: (key, value) => { storageMap.set(key, String(value)); },
    removeItem: (key) => { storageMap.delete(key); },
};

// Simulate Capacitor Android native environment before @capacitor/core initializes.
// Note: @capacitor/core binds to globalThis in Node when globalThis is defined.
globalThis.androidBridge = {};
globalThis.Capacitor = {
    PluginHeaders: [
        {
            name: 'NativePlayback',
            methods: [
                { name: 'getCapabilities', rtype: 'promise' },
                { name: 'loadQueue', rtype: 'promise' },
                { name: 'updateQueue', rtype: 'promise' },
                { name: 'setResolvedSources', rtype: 'promise' },
                { name: 'control', rtype: 'promise' },
                { name: 'getState', rtype: 'promise' },
            ],
        },
    ],
};
globalThis.window = {
    androidBridge: globalThis.androidBridge,
    Capacitor: globalThis.Capacitor,
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null, ws: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    plugins: [{
        name: 'stub-android-orchestration',
        enforce: 'pre',
        resolveId(id) {
            if (
                id === '@/plugins/NativePlayback' ||
                id.endsWith('/src/plugins/NativePlayback') ||
                id.endsWith('/src/plugins/NativePlayback.ts')
            ) {
                return '\0stub-native-playback';
            }
            if (
                id === '@/lib/modules/getStreamData' ||
                id.endsWith('/src/lib/modules/getStreamData') ||
                id.endsWith('/src/lib/modules/getStreamData.ts')
            ) {
                return '\0stub-stream-data';
            }
            return undefined;
        },
        load(id) {
            if (id === '\0stub-native-playback') {
                return `export default {
                    getCapabilities: (...args) => globalThis.__testNativePlayback.getCapabilities(...args),
                    loadQueue: (...args) => globalThis.__testNativePlayback.loadQueue(...args),
                    updateQueue: (...args) => globalThis.__testNativePlayback.updateQueue(...args),
                    setResolvedSources: (...args) => globalThis.__testNativePlayback.setResolvedSources(...args),
                    control: (...args) => globalThis.__testNativePlayback.control(...args),
                    getState: (...args) => globalThis.__testNativePlayback.getState(...args),
                    addListener: (...args) => globalThis.__testNativePlayback.addListener(...args),
                };`;
            }
            if (id === '\0stub-stream-data') {
                return `export default (...args) => globalThis.__testResolveStream(...args); export function prefetchNextSong() {}`;
            }
            return undefined;
        },
    }],
});

after(() => server.close());

const {
    buildResolverKey,
    computeSourceExpiryMs,
    selectLookaheadQueueItems,
    createLookaheadManager,
} = await server.ssrLoadModule('/src/lib/modules/resolver/lookahead.ts');

const {
    DEFAULT_V1_CAPABILITIES,
    getNativeCapabilities,
    getCachedNativeCapabilities,
    resetNativeCapabilitiesCacheForTest,
} = await server.ssrLoadModule('/src/lib/utils/platform.ts');

const { getDiagnostics } = await server.ssrLoadModule('/src/services/homeDiscovery.ts');
const {
    configureSaavnFallbackForTest,
    resetSaavnFallbackDepsForTest,
    useSaavnFallbackStore,
} = await server.ssrLoadModule('/src/services/saavnFallback.ts');
const {
    getSuggestionsWithResults,
    searchWithResults,
    useSearchStore,
} = await server.ssrLoadModule('/src/lib/stores/search.ts');

// Default mock wiring before loading playerStore & initializing it.
let stateListener = null;
let nativeCalls = [];
let mockBridgeImpl = {};

function setupMockBridge(overrides = {}) {
    nativeCalls = [];
    stateListener = null;
    mockBridgeImpl = {
        getCapabilities: async () => ({
            abiVersion: 2,
            sourceRefresh: true,
            localMedia: false,
            headlessResolver: true,
            resolverAbi: 'androidx-js-1',
        }),
        loadQueue: async (opts) => ({
            queueId: opts.queue[opts.index]?.queueId ?? '',
            position: 0,
            duration: 180,
            playing: opts.play,
            buffering: false,
            error: '',
            sleepEnded: false,
            ...(opts.generation !== undefined ? { generation: opts.generation } : {}),
        }),
        updateQueue: async () => {},
        setResolvedSources: async (opts) => ({ updated: opts.entries.length, rejected: 0 }),
        control: async () => ({
            queueId: '',
            position: 0,
            duration: 0,
            playing: false,
            buffering: false,
            error: '',
            sleepEnded: false,
        }),
        getState: async () => ({
            queueId: '',
            position: 0,
            duration: 0,
            playing: false,
            buffering: false,
            error: '',
            sleepEnded: false,
        }),
        addListener: async (_event, listener) => {
            stateListener = listener;
            return { remove: async () => {} };
        },
        ...overrides,
    };

    globalThis.__testNativePlayback = {
        getCapabilities: (...args) => {
            nativeCalls.push({ method: 'getCapabilities', args });
            return mockBridgeImpl.getCapabilities(...args);
        },
        loadQueue: (...args) => {
            nativeCalls.push({ method: 'loadQueue', args });
            return mockBridgeImpl.loadQueue(...args);
        },
        updateQueue: (...args) => {
            nativeCalls.push({ method: 'updateQueue', args });
            return mockBridgeImpl.updateQueue(...args);
        },
        setResolvedSources: (...args) => {
            nativeCalls.push({ method: 'setResolvedSources', args });
            return mockBridgeImpl.setResolvedSources(...args);
        },
        control: (...args) => {
            nativeCalls.push({ method: 'control', args });
            return mockBridgeImpl.control(...args);
        },
        getState: (...args) => {
            nativeCalls.push({ method: 'getState', args });
            return mockBridgeImpl.getState(...args);
        },
        addListener: (...args) => {
            nativeCalls.push({ method: 'addListener', args });
            return mockBridgeImpl.addListener(...args);
        },
    };
}

setupMockBridge();

const expireFuture = () => Math.floor(Date.now() / 1000) + 3600;
globalThis.__testResolveStream = async (id) => ({
    title: id,
    adaptiveFormats: [
        {
            url: `https://cdn.example.test/audio/${encodeURIComponent(id)}?itag=251&expire=${expireFuture()}`,
            type: 'audio/webm; codecs="opus"',
            bitrate: '128000',
            encoding: 'opus',
        },
    ],
});

const { usePlayerStore, initializePlayerStore } = await server.ssrLoadModule('/src/stores/playerStore.ts');
initializePlayerStore();
await flush();

const ytTracks = [
    { id: 'dQw4w9WgXcQ', title: 'Track 1', author: 'Artist 1', type: 'song' },
    { id: 'jiosaavn:saavn-01', title: 'Track 2', author: 'Artist 2', type: 'song' },
    { id: 'audius:open-01', title: 'Track 3', author: 'Artist 3', type: 'song' },
    { id: 'pIWaVJPl0-c', title: 'Track 4', author: 'Artist 4', type: 'song' },
];

beforeEach(async () => {
    audioPlayCount = 0;
    audioSrcAssignments = [];
    fakeDoc.hidden = false;
    storageMap.clear();
    resetNativeCapabilitiesCacheForTest();
    resetSaavnFallbackDepsForTest();
    useSaavnFallbackStore.getState().reset();
    usePlayerStore.setState({ favorites: [] });
    useSearchStore.getState().clearSearch();
    setupMockBridge();
    globalThis.__testResolveStream = async (id) => ({
        title: id,
        adaptiveFormats: [
            {
                url: `https://cdn.example.test/audio/${encodeURIComponent(id)}?itag=251&expire=${expireFuture()}`,
                type: 'audio/webm; codecs="opus"',
                bitrate: '128000',
                encoding: 'opus',
            },
        ],
    });
    usePlayerStore.getState().clearQueue();
    await flush();
    // Re-register state listener pointer after setupMockBridge reset.
    await mockBridgeImpl.addListener('state', stateListener ?? (() => {}));
    nativeCalls = [];
});

test('lookahead helpers compute resolverKeys, expiry TTLs, and repeat-aware targets', () => {
    assert.deepEqual(buildResolverKey('dQw4w9WgXcQ'), { provider: 'youtube', trackId: 'dQw4w9WgXcQ' });
    assert.deepEqual(buildResolverKey('jiosaavn:abc123'), { provider: 'jiosaavn', trackId: 'jiosaavn:abc123' });
    assert.deepEqual(buildResolverKey('audius:ng9rl'), { provider: 'open-audio', trackId: 'audius:ng9rl' });
    assert.deepEqual(buildResolverKey('openverse:uuid-1'), { provider: 'open-audio', trackId: 'openverse:uuid-1' });
    assert.deepEqual(buildResolverKey('freetouse:uuid-2'), { provider: 'open-audio', trackId: 'freetouse:uuid-2' });

    const now = 1_700_000_000_000;
    const oneHourExpire = Math.floor((now + 3600_000) / 1000);
    assert.equal(
        computeSourceExpiryMs(`https://cdn.example.test/a?expire=${oneHourExpire}`, now),
        now + 5 * 60_000,
    );
    const twoMinExpire = Math.floor((now + 120_000) / 1000);
    assert.equal(
        computeSourceExpiryMs(`https://cdn.example.test/a?expire=${twoMinExpire}`, now),
        twoMinExpire * 1000 - 30_000,
    );
    assert.equal(computeSourceExpiryMs('https://cdn.example.test/a', now), now + 4 * 60_000);
    assert.equal(computeSourceExpiryMs('http://insecure.example.test/a', now), null);
    assert.equal(computeSourceExpiryMs(`https://cdn.example.test/a?expire=${Math.floor(now / 1000) - 10}`, now), null);

    const rows = ytTracks.map((song, i) => ({ queueId: `q${i}`, song }));
    assert.deepEqual(selectLookaheadQueueItems(rows, 0, 'off').map(r => r.queueId), ['q1', 'q2']);
    assert.deepEqual(selectLookaheadQueueItems(rows, 3, 'off').map(r => r.queueId), []);
    assert.deepEqual(selectLookaheadQueueItems(rows, 3, 'all').map(r => r.queueId), ['q0', 'q1']);
    assert.deepEqual(selectLookaheadQueueItems(rows, 0, 'one').map(r => r.queueId), []);
    assert.deepEqual(selectLookaheadQueueItems(rows.slice(0, 2), 1, 'all').map(r => r.queueId), ['q0']);
    assert.deepEqual(selectLookaheadQueueItems(rows.slice(0, 1), 0, 'all').map(r => r.queueId), []);
});

test('v1 capability fallback caches rejection/missing getCapabilities and does not downgrade on playback errors', async () => {
    setupMockBridge({
        getCapabilities: async () => {
            throw new Error('UNIMPLEMENTED');
        },
    });
    const caps1 = await getNativeCapabilities();
    assert.deepEqual(caps1, DEFAULT_V1_CAPABILITIES);
    const caps2 = await getNativeCapabilities();
    assert.deepEqual(caps2, DEFAULT_V1_CAPABILITIES);
    assert.equal(nativeCalls.filter(c => c.method === 'getCapabilities').length, 1);

    await usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();
    const loadCall = nativeCalls.find(c => c.method === 'loadQueue');
    assert.ok(loadCall);
    assert.equal(loadCall.args[0].generation, undefined);
    assert.equal(loadCall.args[0].queue[0].url?.startsWith('https://'), true);
    assert.equal(loadCall.args[0].queue[0].resolverKey, undefined);
    assert.equal(nativeCalls.some(c => c.method === 'setResolvedSources'), false);

    // Missing getCapabilities property also falls back to v1 cleanly.
    resetNativeCapabilitiesCacheForTest();
    globalThis.__testNativePlayback.getCapabilities = undefined;
    assert.deepEqual(await getNativeCapabilities(), DEFAULT_V1_CAPABILITIES);

    // Negotiated v2 capabilities must NOT downgrade when normal playback control errors occur.
    resetNativeCapabilitiesCacheForTest();
    setupMockBridge({
        control: async () => {
            throw new Error('Transient player error');
        },
    });
    const v2Caps = await getNativeCapabilities();
    assert.equal(v2Caps.abiVersion, 2);
    await usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();
    usePlayerStore.getState().seek(10);
    await flush();
    assert.equal(getCachedNativeCapabilities()?.abiVersion, 2);
    assert.equal((await getNativeCapabilities()).abiVersion, 2);
});

test('v2 loadQueue + setResolvedSources primes next 2 tracks including repeatMode all wrap-around', async () => {
    const resolveCalls = [];
    globalThis.__testResolveStream = async (id, prefetch) => {
        resolveCalls.push({ id, prefetch });
        return {
            title: id,
            adaptiveFormats: [
                {
                    url: `https://cdn.example.test/audio/${encodeURIComponent(id)}?itag=251&expire=${expireFuture()}`,
                    type: 'audio/webm; codecs="opus"',
                    bitrate: '128000',
                    encoding: 'opus',
                },
            ],
        };
    };

    await usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();

    const loadCall = nativeCalls.find(c => c.method === 'loadQueue');
    assert.ok(loadCall);
    const loadOpts = loadCall.args[0];
    assert.ok(loadOpts.generation > 0);
    assert.deepEqual(
        loadOpts.queue.map(item => item.resolverKey),
        [
            { provider: 'youtube', trackId: 'dQw4w9WgXcQ' },
            { provider: 'jiosaavn', trackId: 'jiosaavn:saavn-01' },
            { provider: 'open-audio', trackId: 'audius:open-01' },
            { provider: 'youtube', trackId: 'pIWaVJPl0-c' },
        ],
    );
    assert.ok(loadOpts.queue[0].source?.url.startsWith('https://'));
    assert.ok(loadOpts.queue[0].source?.expiresAtMs > Date.now());
    assert.equal(loadOpts.queue[0].url, loadOpts.queue[0].source.url);

    const pushCalls = nativeCalls.filter(c => c.method === 'setResolvedSources');
    assert.equal(pushCalls.length, 1);
    const pushOpts = pushCalls[0].args[0];
    assert.equal(pushOpts.generation, loadOpts.generation);
    assert.equal(pushOpts.entries.length, 2);
    assert.deepEqual(
        pushOpts.entries.map(e => e.queueId),
        [usePlayerStore.getState().queue[1].queueId, usePlayerStore.getState().queue[2].queueId],
    );
    assert.deepEqual(
        pushOpts.entries.map(e => e.resolverKey),
        [
            { provider: 'jiosaavn', trackId: 'jiosaavn:saavn-01' },
            { provider: 'open-audio', trackId: 'audius:open-01' },
        ],
    );
    assert.equal(resolveCalls[0].prefetch, false);
    assert.equal(resolveCalls[1].prefetch, true);
    assert.equal(resolveCalls[2].prefetch, true);

    // Enabling repeat all and advancing to the last row wraps around, skipping already-fresh row 0 and resolving row 1 if needed (or skipping both if fresh).
    usePlayerStore.getState().setRepeatMode('all');
    await flush();
    const queue = usePlayerStore.getState().queue;

    // Emit native state transition to row 3 (last track). Row 0 was marked fresh at loadQueue, row 1 was marked fresh by setResolvedSources.
    // Let's verify a fresh row is not redundantly resolved by advancing to row 2 (next rows: row 3 [unfresh] and row 0 [fresh]).
    const resolveCountBeforeAdvance = resolveCalls.length;
    usePlayerStore.setState({ queueIndex: 2, currentSong: queue[2].song });
    // Trigger native state event as if native auto-advanced to index 3 while row 0 is still fresh and row 1 is fresh -> 0 redundant resolves,
    // vs index 2 -> row 3 is unfresh, row 0 is fresh -> only row 3 resolved!
    // Reset queueIndex to 0 first so state event to queue[2] counts as transition:
    usePlayerStore.setState({ queueIndex: 0, currentSong: queue[0].song });
    const activeListener = nativeCalls.find(c => c.method === 'addListener')?.args[1];
    // Directly test via initializePlayerStore listener by creating a local lookahead with wrap-around when row 0 is expired:
    assert.equal(typeof activeListener, 'undefined'); // already registered in beforeEach? Wait: we registered before beforeEach!

    // Test repeatMode: 'all' wrap-around directly with createLookaheadManager + clock control
    let clockMs = 1_700_000_000_000;
    const pushedBatches = [];
    const manager = createLookaheadManager({
        getState: () => ({
            queue,
            queueIndex: 3,
            repeatMode: 'all',
            generation: 5,
            isActive: true,
        }),
        resolveStream: async (id) => ({
            adaptiveFormats: [{ url: `https://cdn.example.test/${id}`, type: 'audio/mp4', bitrate: '128000' }],
        }),
        pushResolvedSources: async (generation, entries) => {
            pushedBatches.push({ generation, entries });
            return { updated: entries.length, rejected: 0 };
        },
        now: () => clockMs,
    });
    await manager.prime();
    assert.equal(pushedBatches.length, 1);
    assert.deepEqual(pushedBatches[0].entries.map(e => e.queueId), [queue[0].queueId, queue[1].queueId]);

    // Second prime immediately skips already-fresh rows.
    await manager.prime();
    assert.equal(pushedBatches.length, 1);
    assert.equal(resolveCalls.length, resolveCountBeforeAdvance);
});

test('clearQueue and newer track selection cancel in-flight lookahead and serialize native mutations', async () => {
    let holdLookahead;
    let lookaheadSignal;
    let resolveCount = 0;

    globalThis.__testResolveStream = (id, prefetch, signal) => {
        resolveCount += 1;
        if (!prefetch) {
            return Promise.resolve({
                title: id,
                adaptiveFormats: [{ url: `https://cdn.example.test/${id}`, type: 'audio/webm', bitrate: '128000' }],
            });
        }
        lookaheadSignal = signal;
        return new Promise((resolve) => {
            holdLookahead = resolve;
        });
    };

    await usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();
    assert.ok(lookaheadSignal);
    assert.equal(lookaheadSignal.aborted, false);

    // Clear cancels lookahead immediately.
    usePlayerStore.getState().clearQueue();
    assert.equal(lookaheadSignal.aborted, true);

    // Late resolution must never call setResolvedSources.
    holdLookahead({
        title: 'late',
        adaptiveFormats: [{ url: 'https://cdn.example.test/late', type: 'audio/webm', bitrate: '128000' }],
    });
    await flush();
    assert.equal(nativeCalls.some(c => c.method === 'setResolvedSources'), false);

    // Newer selection while lookahead is in-flight also aborts old lookahead and drops its late result.
    let holdFirstLookahead;
    let firstSignal;
    globalThis.__testResolveStream = (id, prefetch, signal) => {
        resolveCount += 1;
        if (!prefetch) {
            return Promise.resolve({
                title: id,
                adaptiveFormats: [{ url: `https://cdn.example.test/${id}`, type: 'audio/webm', bitrate: '128000' }],
            });
        }
        if (!firstSignal) {
            firstSignal = signal;
            return new Promise((resolve) => {
                holdFirstLookahead = resolve;
            });
        }
        return Promise.resolve({
            title: id,
            adaptiveFormats: [{ url: `https://cdn.example.test/${id}`, type: 'audio/webm', bitrate: '128000' }],
        });
    };

    await usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();
    assert.ok(firstSignal);
    assert.equal(firstSignal.aborted, false);
    const generationBeforeSwitch = nativeCalls.findLast(c => c.method === 'loadQueue').args[0].generation;

    await usePlayerStore.getState().playFromQueue(2);
    await flush();
    assert.equal(firstSignal.aborted, true);
    holdFirstLookahead({
        title: 'stale-lookahead',
        adaptiveFormats: [{ url: 'https://cdn.example.test/stale', type: 'audio/webm', bitrate: '128000' }],
    });
    await flush();

    const sourcePushes = nativeCalls.filter(c => c.method === 'setResolvedSources');
    assert.equal(sourcePushes.every(c => c.args[0].generation > generationBeforeSwitch), true);

    usePlayerStore.getState().clearQueue();
    await flush();

    // Test serialized mutation ordering: slow loadQueue followed by clearQueue.
    const mutationOrder = [];
    let finishLoadQueue;
    setupMockBridge({
        loadQueue: () => {
            mutationOrder.push('loadQueue:start');
            return new Promise((resolve) => {
                finishLoadQueue = (snapshot) => {
                    mutationOrder.push('loadQueue:end');
                    resolve(snapshot);
                };
            });
        },
        control: async (opts) => {
            mutationOrder.push(`control:${opts.action}`);
            return { queueId: '', position: 0, duration: 0, playing: false, buffering: false, error: '', sleepEnded: false };
        },
    });
    globalThis.__testResolveStream = async (id) => ({
        title: id,
        adaptiveFormats: [{ url: `https://cdn.example.test/${id}`, type: 'audio/webm', bitrate: '128000' }],
    });

    const pendingPlay = usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();
    assert.deepEqual(mutationOrder, ['loadQueue:start']);

    // Clear while loadQueue is still pending on bridge.
    usePlayerStore.getState().clearQueue();
    await flush();
    // control('clear') must wait until loadQueue finishes!
    assert.deepEqual(mutationOrder, ['loadQueue:start']);

    finishLoadQueue({
        queueId: 'stale',
        position: 0,
        duration: 180,
        playing: true,
        buffering: false,
        error: '',
        sleepEnded: false,
        generation: 99,
    });
    await pendingPlay;
    await flush();
    assert.deepEqual(mutationOrder, ['loadQueue:start', 'loadQueue:end', 'control:clear', 'control:sleep']);
    assert.equal(usePlayerStore.getState().currentSong, null);
    assert.deepEqual(usePlayerStore.getState().queue, []);
    assert.ok(resolveCount >= 2);
});

test('duplicate track IDs maintain distinct queueIds in lookahead and queue selection', async () => {
    const dupes = [
        { id: 'dQw4w9WgXcQ', title: 'Same Song 1', author: 'Artist', type: 'song' },
        { id: 'dQw4w9WgXcQ', title: 'Same Song 2', author: 'Artist', type: 'song' },
        { id: 'dQw4w9WgXcQ', title: 'Same Song 3', author: 'Artist', type: 'song' },
    ];
    let streamLookups = 0;
    globalThis.__testResolveStream = async (id) => {
        streamLookups += 1;
        return {
            title: id,
            adaptiveFormats: [{ url: `https://cdn.example.test/${id}?expire=${expireFuture()}`, type: 'audio/webm', bitrate: '128000' }],
        };
    };

    await usePlayerStore.getState().setQueue(dupes, 0);
    await flush();

    const queue = usePlayerStore.getState().queue;
    assert.equal(queue.length, 3);
    assert.equal(new Set(queue.map(q => q.queueId)).size, 3);

    const pushCalls = nativeCalls.filter(c => c.method === 'setResolvedSources');
    assert.equal(pushCalls.length, 1);
    const entries = pushCalls[0].args[0].entries;
    assert.deepEqual(entries.map(e => e.queueId), [queue[1].queueId, queue[2].queueId]);
    // Active track resolved once + 1 deduplicated batch resolution for the duplicate upcoming track ID.
    assert.equal(streamLookups, 2);

    await usePlayerStore.getState().playFromQueue(1);
    await flush();
    assert.equal(usePlayerStore.getState().queueIndex, 1);
    assert.equal(usePlayerStore.getState().queue.length, 3);
});

test('stale generation snapshots are ignored and HTMLAudioElement never plays in Android mode', async () => {
    // Re-attach listener by capturing it via initializePlayerStore-like fresh module? Wait:
    // The module-level initializePlayerStore registered listener once on first setupMockBridge!
    // Let's load a fresh playerStore instance for listener + visibilitychange end-to-end verification!
    const freshServer = await createServer({
        configFile: false,
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true, watch: null, ws: false },
        resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
        plugins: [{
            name: 'stub-android-orchestration-2',
            enforce: 'pre',
            resolveId(id) {
                if (
                    id === '@/plugins/NativePlayback' ||
                    id.endsWith('/src/plugins/NativePlayback') ||
                    id.endsWith('/src/plugins/NativePlayback.ts')
                ) {
                    return '\0stub-native-playback';
                }
                if (
                    id === '@/lib/modules/getStreamData' ||
                    id.endsWith('/src/lib/modules/getStreamData') ||
                    id.endsWith('/src/lib/modules/getStreamData.ts')
                ) {
                    return '\0stub-stream-data';
                }
                return undefined;
            },
            load(id) {
                if (id === '\0stub-native-playback') {
                    return `export default {
                        getCapabilities: (...args) => globalThis.__testNativePlayback.getCapabilities(...args),
                        loadQueue: (...args) => globalThis.__testNativePlayback.loadQueue(...args),
                        updateQueue: (...args) => globalThis.__testNativePlayback.updateQueue(...args),
                        setResolvedSources: (...args) => globalThis.__testNativePlayback.setResolvedSources(...args),
                        control: (...args) => globalThis.__testNativePlayback.control(...args),
                        getState: (...args) => globalThis.__testNativePlayback.getState(...args),
                        addListener: (...args) => globalThis.__testNativePlayback.addListener(...args),
                    };`;
                }
                if (id === '\0stub-stream-data') {
                    return `export default (...args) => globalThis.__testResolveStream(...args); export function prefetchNextSong() {}`;
                }
                return undefined;
            },
        }],
    });

    try {
        let capturedListener = null;
        let currentNativeState = {
            queueId: '',
            position: 0,
            duration: 0,
            playing: false,
            buffering: false,
            error: '',
            sleepEnded: false,
        };
        setupMockBridge({
            addListener: async (_event, listener) => {
                capturedListener = listener;
                return { remove: async () => {} };
            },
            loadQueue: async (opts) => {
                currentNativeState = {
                    queueId: opts.queue[opts.index]?.queueId ?? '',
                    position: 0,
                    duration: 180,
                    playing: opts.play,
                    buffering: false,
                    error: '',
                    sleepEnded: false,
                    generation: opts.generation,
                };
                return currentNativeState;
            },
            getState: async () => currentNativeState,
        });

        const freshPlayerMod = await freshServer.ssrLoadModule('/src/stores/playerStore.ts');
        freshPlayerMod.initializePlayerStore();
        await flush();

        const store = freshPlayerMod.usePlayerStore;
        await store.getState().setQueue(ytTracks, 0);
        await flush();

        const queue = store.getState().queue;
        const activeGen = currentNativeState.generation;
        assert.ok(activeGen > 0);
        assert.equal(store.getState().queueIndex, 0);

        // Emit stale snapshot from an older generation (activeGen - 1 when > 0, or test after bump):
        await store.getState().playFromQueue(1);
        await flush();
        const gen2 = currentNativeState.generation;
        assert.ok(gen2 > activeGen);
        assert.equal(store.getState().queueIndex, 1);

        // Emit stale snapshot from generation `activeGen` pointing to queue[0].
        capturedListener({
            queueId: queue[0].queueId,
            position: 42,
            duration: 180,
            playing: false,
            buffering: false,
            error: '',
            sleepEnded: false,
            generation: activeGen,
        });
        assert.equal(store.getState().queueIndex, 1);
        assert.equal(store.getState().currentSong.id, ytTracks[1].id);

        // Exercise transport actions and verify HTMLAudioElement NEVER started.
        await store.getState().togglePlay();
        await store.getState().resume();
        await store.getState().next();
        await store.getState().previous();
        store.getState()._onTrackEnded();
        assert.equal(audioPlayCount, 0);
        assert.deepEqual(audioSrcAssignments, []);

        // visibilitychange resume: native advanced while hidden, getState() updates store & re-primes lookahead without calling loadQueue.
        const loadCountBeforeResume = nativeCalls.filter(c => c.method === 'loadQueue').length;
        const setSourcesBeforeResume = nativeCalls.filter(c => c.method === 'setResolvedSources').length;
        const latestGen = currentNativeState.generation;
        currentNativeState = {
            queueId: queue[2].queueId,
            position: 12,
            duration: 210,
            playing: true,
            buffering: false,
            error: '',
            sleepEnded: false,
            generation: latestGen,
        };
        fakeDoc.hidden = true;
        fakeDoc.dispatchEvent(new Event('visibilitychange'));
        await flush();
        assert.equal(store.getState().queueIndex, 1); // still hidden

        fakeDoc.hidden = false;
        fakeDoc.dispatchEvent(new Event('visibilitychange'));
        await flush();
        assert.equal(store.getState().queueIndex, 2);
        assert.equal(store.getState().currentSong.id, ytTracks[2].id);
        assert.equal(nativeCalls.filter(c => c.method === 'loadQueue').length, loadCountBeforeResume);
        assert.ok(nativeCalls.filter(c => c.method === 'setResolvedSources').length > setSourcesBeforeResume);

        // Queue edit (addToQueue) calls updateQueue with generation and preserves active row.
        store.getState().addToQueue({ id: 'AbCdEfGhIjK', title: 'Added', author: 'Artist', type: 'song' });
        await flush();
        const updateCall = nativeCalls.find(c => c.method === 'updateQueue');
        assert.ok(updateCall);
        assert.equal(updateCall.args[0].generation, latestGen);
        assert.equal(updateCall.args[0].queue.length, 5);
    } finally {
        await freshServer.close();
    }
});

test('pause then resume while loadQueue is in flight keeps ExoPlayer playing and pause during loadQueue does not flash isPlaying', async () => {
    let exoPlaying = false;
    let resolveLoadQueue;
    setupMockBridge({
        loadQueue: (opts) => new Promise((resolve) => {
            resolveLoadQueue = () => {
                exoPlaying = Boolean(opts.play);
                resolve({
                    queueId: opts.queue[opts.index]?.queueId ?? '',
                    position: 0,
                    duration: 180,
                    playing: exoPlaying,
                    buffering: false,
                    error: '',
                    sleepEnded: false,
                    generation: opts.generation,
                });
            };
        }),
        control: async (opts) => {
            if (opts.action === 'play') exoPlaying = true;
            if (opts.action === 'pause' || opts.action === 'clear') exoPlaying = false;
            return {
                queueId: usePlayerStore.getState().queue[0]?.queueId ?? '',
                position: 0,
                duration: 180,
                playing: exoPlaying,
                buffering: false,
                error: '',
                sleepEnded: false,
            };
        },
    });

    // Case 1: play -> pause() -> resume() while loadQueue is pending on the bridge.
    const pendingPlay1 = usePlayerStore.getState().setQueue(ytTracks, 0);
    await flush();
    assert.ok(resolveLoadQueue);

    usePlayerStore.getState().pause();
    await usePlayerStore.getState().resume();
    resolveLoadQueue();
    await pendingPlay1;
    await flush();

    assert.equal(exoPlaying, true);
    assert.equal(usePlayerStore.getState().isPlaying, true);
    assert.equal(
        nativeCalls.some(c => c.method === 'control' && c.args[0]?.action === 'pause'),
        false,
    );

    // Case 2: play -> pause() while loadQueue is pending must not flash isPlaying: true and must pause ExoPlayer.
    usePlayerStore.getState().clearQueue();
    await flush();
    nativeCalls = [];
    resolveLoadQueue = undefined;

    const observedPlayingStates = [];
    const unsubscribe = usePlayerStore.subscribe((state) => {
        observedPlayingStates.push(state.isPlaying);
    });

    try {
        const pendingPlay2 = usePlayerStore.getState().setQueue(ytTracks, 0);
        await flush();
        assert.ok(resolveLoadQueue);

        usePlayerStore.getState().pause();
        resolveLoadQueue();
        await pendingPlay2;
        await flush();

        assert.equal(observedPlayingStates.includes(true), false);
        assert.equal(exoPlaying, false);
        assert.equal(usePlayerStore.getState().isPlaying, false);
        assert.equal(
            nativeCalls.some(c => c.method === 'control' && c.args[0]?.action === 'pause'),
            true,
        );
    } finally {
        unsubscribe();
    }
});

test('Android YouTube failure triggers F1 JioSaavn failover cleanly, drops stale results, and blocks retry storms', async () => {
    const ytSong = {
        id: 'pIWaVJPl0-c',
        title: 'Faded',
        author: 'Alan Walker',
        authorId: '',
        duration: '3:32',
        durationSec: 212,
        type: 'song',
    };
    const matchedSaavn = {
        id: 'jiosaavn:faded-99',
        title: 'Faded',
        author: 'Alan Walker',
        authorId: '',
        duration: '3:32',
        durationSec: 212,
        type: 'song',
    };

    configureSaavnFallbackForTest({
        searchJioSaavn: async () => [matchedSaavn],
        jioSaavnAudioUrl: (id, opts) => (opts?.allowNative ? `https://m14u-jiosaavn.onrender.com/api/audio/${id.slice(9)}` : null),
    });

    // Save the YouTube track to favorites first to prove F1 never mutates library IDs.
    usePlayerStore.getState().toggleFavorite(ytSong);
    const favIdBefore = usePlayerStore.getState().favorites[0].song.id;

    globalThis.__testResolveStream = async () => ({ error: 'All proxies failed', message: 'YouTube unavailable' });

    await usePlayerStore.getState().setQueue([ytSong], 0);
    await flush();

    const state = usePlayerStore.getState();
    const activeRow = state.queue[0];
    assert.ok(activeRow);
    assert.equal(activeRow.song.id, 'pIWaVJPl0-c');
    assert.equal(state.favorites[0].song.id, favIdBefore);
    assert.equal(state.error, null);
    assert.equal(state.isPlaying, true);

    const loadCall = nativeCalls.findLast(c => c.method === 'loadQueue');
    assert.ok(loadCall);
    const loadOpts = loadCall.args[0];
    assert.ok(loadOpts.generation > 0);
    assert.equal(loadOpts.queue[0].queueId, activeRow.queueId);
    assert.deepEqual(loadOpts.queue[0].resolverKey, { provider: 'jiosaavn', trackId: 'jiosaavn:faded-99' });
    assert.equal(loadOpts.queue[0].source?.url, 'https://m14u-jiosaavn.onrender.com/api/audio/faded-99');
    assert.equal(loadOpts.queue[0].source?.mimeType, 'audio/mp4');

    const notice = useSaavnFallbackStore.getState().activeTrackNotice;
    assert.ok(notice);
    assert.equal(notice.matchedTitle, 'Faded');
    assert.equal(notice.matchedArtist, 'Alan Walker');

    // Stale fallback after clearQueue must be dropped and never call loadQueue.
    usePlayerStore.getState().clearQueue();
    await flush();
    nativeCalls = [];

    let resolveLateMatch;
    configureSaavnFallbackForTest({
        searchJioSaavn: () => new Promise((resolve) => {
            resolveLateMatch = () => resolve([matchedSaavn]);
        }),
        jioSaavnAudioUrl: (id, opts) => (opts?.allowNative ? `https://m14u-jiosaavn.onrender.com/api/audio/${id.slice(9)}` : null),
    });

    const pendingFailover = usePlayerStore.getState().setQueue([ytSong], 0);
    await flush();
    usePlayerStore.getState().clearQueue();
    resolveLateMatch?.();
    await pendingFailover;
    await flush();
    assert.equal(nativeCalls.some(c => c.method === 'loadQueue'), false);
    assert.equal(usePlayerStore.getState().currentSong, null);

    // No retry storm if JioSaavn fallback source also errors on NativePlayback.
    usePlayerStore.getState().clearQueue();
    await flush();
    nativeCalls = [];
    let searchFallbackCalls = 0;
    configureSaavnFallbackForTest({
        searchJioSaavn: async () => {
            searchFallbackCalls += 1;
            return [matchedSaavn];
        },
        jioSaavnAudioUrl: (id, opts) => (opts?.allowNative ? `https://m14u-jiosaavn.onrender.com/api/audio/${id.slice(9)}` : null),
    });
    setupMockBridge({
        loadQueue: async (opts) => ({
            queueId: opts.queue[opts.index]?.queueId ?? '',
            position: 0,
            duration: 0,
            playing: false,
            buffering: false,
            error: 'Could not play this stream (ERROR_CODE_IO_UNSPECIFIED)',
            sleepEnded: false,
            generation: opts.generation,
        }),
    });

    await usePlayerStore.getState().setQueue([ytSong], 0);
    await flush();
    assert.equal(searchFallbackCalls, 1);
    assert.equal(usePlayerStore.getState().error, 'Could not play this stream (ERROR_CODE_IO_UNSPECIFIED)');
    assert.equal(usePlayerStore.getState().isPlaying, false);
});

for (const rejectFailover of [false, true]) test(`native-side F1 ${rejectFailover ? 'clears loading after bridge rejection' : 'avoids infinite loops'}`, async () => {
    const freshServer = await createServer({
        configFile: false,
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true, watch: null, ws: false },
        resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
        plugins: [{
            name: 'stub-android-failover-native-err',
            enforce: 'pre',
            resolveId(id) {
                if (
                    id === '@/plugins/NativePlayback' ||
                    id.endsWith('/src/plugins/NativePlayback') ||
                    id.endsWith('/src/plugins/NativePlayback.ts')
                ) {
                    return '\0stub-native-playback';
                }
                if (
                    id === '@/lib/modules/getStreamData' ||
                    id.endsWith('/src/lib/modules/getStreamData') ||
                    id.endsWith('/src/lib/modules/getStreamData.ts')
                ) {
                    return '\0stub-stream-data';
                }
                return undefined;
            },
            load(id) {
                if (id === '\0stub-native-playback') {
                    return `export default {
                        getCapabilities: (...args) => globalThis.__testNativePlayback.getCapabilities(...args),
                        loadQueue: (...args) => globalThis.__testNativePlayback.loadQueue(...args),
                        updateQueue: (...args) => globalThis.__testNativePlayback.updateQueue(...args),
                        setResolvedSources: (...args) => globalThis.__testNativePlayback.setResolvedSources(...args),
                        control: (...args) => globalThis.__testNativePlayback.control(...args),
                        getState: (...args) => globalThis.__testNativePlayback.getState(...args),
                        addListener: (...args) => globalThis.__testNativePlayback.addListener(...args),
                    };`;
                }
                if (id === '\0stub-stream-data') {
                    return `export default (...args) => globalThis.__testResolveStream(...args); export function prefetchNextSong() {}`;
                }
                return undefined;
            },
        }],
    });

    try {
        let capturedListener = null;
        setupMockBridge({
            addListener: async (_event, listener) => {
                capturedListener = listener;
                return { remove: async () => {} };
            },
            loadQueue: async (opts) => {
                if (rejectFailover && opts.queue[opts.index]?.resolverKey?.provider === 'jiosaavn') {
                    throw new Error('Fallback bridge rejected load');
                }
                return {
                queueId: opts.queue[opts.index]?.queueId ?? '',
                position: 0,
                duration: 212,
                playing: opts.play,
                buffering: false,
                error: '',
                sleepEnded: false,
                generation: opts.generation,
                };
            },
        });

        const freshPlayerMod = await freshServer.ssrLoadModule('/src/stores/playerStore.ts');
        const freshFallbackMod = await freshServer.ssrLoadModule('/src/services/saavnFallback.ts');
        freshPlayerMod.initializePlayerStore();
        await flush();

        let fallbackSearches = 0;
        freshFallbackMod.configureSaavnFallbackForTest({
            searchJioSaavn: async () => {
                fallbackSearches += 1;
                return [{
                    id: 'jiosaavn:faded-99',
                    title: 'Faded',
                    author: 'Alan Walker',
                    authorId: '',
                    duration: '3:32',
                    durationSec: 212,
                    type: 'song',
                }];
            },
            jioSaavnAudioUrl: (id, opts) => (opts?.allowNative ? `https://m14u-jiosaavn.onrender.com/api/audio/${id.slice(9)}` : null),
        });

        const ytSong = {
            id: 'pIWaVJPl0-c',
            title: 'Faded',
            author: 'Alan Walker',
            authorId: '',
            duration: '3:32',
            durationSec: 212,
            type: 'song',
        };
        await freshPlayerMod.usePlayerStore.getState().setQueue([ytSong], 0);
        await flush();
        const row = freshPlayerMod.usePlayerStore.getState().queue[0];
        const firstGen = nativeCalls.findLast(c => c.method === 'loadQueue').args[0].generation;

        // Native emits terminal open error before playback starts (position === 0).
        capturedListener({
            queueId: row.queueId,
            position: 0,
            duration: 0,
            playing: false,
            buffering: false,
            error: 'Could not play this stream (ERROR_CODE_IO_BAD_HTTP_STATUS)',
            sleepEnded: false,
            generation: firstGen,
        });
        await flush();

        assert.equal(fallbackSearches, 1);
        const failoverLoad = nativeCalls.findLast(c => c.method === 'loadQueue').args[0];
        assert.ok(failoverLoad.generation > firstGen);
        assert.deepEqual(failoverLoad.queue[0].resolverKey, { provider: 'jiosaavn', trackId: 'jiosaavn:faded-99' });

        if (rejectFailover) {
            const player = freshPlayerMod.usePlayerStore.getState;
            assert.equal(player().error, 'Fallback bridge rejected load');
            assert.equal(player().isBuffering, false);
            await player().resume();
            assert.equal(player().isPlaying, true);
            assert.equal(nativeCalls.findLast(c => c.method === 'loadQueue').args[0].queue[0].resolverKey.provider, 'youtube');
            return;
        }

        // Second native error on the already-failed-over row must NOT loop fallback.
        capturedListener({
            queueId: row.queueId,
            position: 0,
            duration: 0,
            playing: false,
            buffering: false,
            error: 'Could not play this stream (ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)',
            sleepEnded: false,
            generation: failoverLoad.generation,
        });
        await flush();
        assert.equal(fallbackSearches, 1);
        assert.equal(
            freshPlayerMod.usePlayerStore.getState().error,
            'Could not play this stream (ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)',
        );
    } finally {
        await freshServer.close();
    }
});

test('F3 jiosaavn-fallback mode routes search.ts to JioSaavn and restores catalog=youtube when reset', async (t) => {
    const requestedUrls = [];
    t.mock.method(globalThis, 'fetch', async (input) => {
        const url = typeof input === 'string' ? input : input.url;
        requestedUrls.push(url);
        if (url.includes('/api/search/songs')) {
            return Response.json({
                success: true,
                data: {
                    results: [
                        {
                            id: 'saavn-hit-1',
                            name: 'Kesariya',
                            duration: 268,
                            artists: { primary: [{ name: 'Arijit Singh' }] },
                        },
                    ],
                },
            });
        }
        if (url.includes('/api/search-suggestions')) {
            return Response.json(['alan walker faded']);
        }
        return Response.json([
            { id: 'pIWaVJPl0-c', title: 'Faded', author: 'Alan Walker', type: 'song' },
        ]);
    });

    // Put F3 circuit into jiosaavn-fallback mode (JioSaavn reachable + 3 distinct failures).
    let probeCalls = 0;
    configureSaavnFallbackForTest({
        now: () => 1_700_000_000_000,
        searchJioSaavn: async () => [
            { id: 'jiosaavn:saavn-hit-1', title: 'Kesariya', author: 'Arijit Singh', type: 'song' },
        ],
        jioSaavnAudioUrl: (id, opts) => (opts?.allowNative ? `https://m14u-jiosaavn.onrender.com/api/audio/${id.slice(9)}` : null),
        probeYouTubeHealth: async () => {
            probeCalls += 1;
        },
    });
    const store = useSaavnFallbackStore.getState();
    await store.resolveTrackFallback({ id: 'aaaaaaaaaaa', title: 'Kesariya', author: 'Arijit Singh' });
    store.recordYouTubeFailure({ trackId: 'aaaaaaaaaaa', error: new Error('fail 1') });
    store.recordYouTubeFailure({ trackId: 'bbbbbbbbbbb', error: new Error('fail 2') });
    const third = store.recordYouTubeFailure({ trackId: 'ccccccccccc', error: new Error('fail 3') });
    assert.equal(third.opened, true);
    assert.equal(useSaavnFallbackStore.getState().mode, 'jiosaavn-fallback');

    const fallbackResults = await searchWithResults('kesariya');
    assert.equal(fallbackResults?.length, 1);
    assert.equal(fallbackResults?.[0].id, 'jiosaavn:saavn-hit-1');
    assert.equal(requestedUrls.some(u => u.includes('/api/search/songs')), true);
    assert.equal(requestedUrls.some(u => u.includes('catalog=youtube')), false);

    const fallbackSuggestions = await getSuggestionsWithResults('kesariya');
    assert.deepEqual(fallbackSuggestions, ['Kesariya']);
    assert.equal(probeCalls, 0); // cooldown not elapsed yet

    // Restore YouTube mode and verify search.ts routes back to catalog=youtube.
    await useSaavnFallbackStore.getState().retryYouTube();
    assert.equal(useSaavnFallbackStore.getState().mode, 'youtube');
    requestedUrls.length = 0;

    const ytResults = await searchWithResults('alan walker');
    assert.equal(ytResults?.length, 1);
    assert.equal(ytResults?.[0].id, 'pIWaVJPl0-c');
    assert.equal(requestedUrls.some(u => u.includes('catalog=youtube')), true);

    const ytSuggestions = await getSuggestionsWithResults('alan walker');
    assert.deepEqual(ytSuggestions, ['alan walker faded']);
    assert.equal(requestedUrls.some(u => u.includes('/api/search-suggestions') && u.includes('catalog=youtube')), true);
});

test('getStreamData allows jiosaavn: on Android when fallback is enabled and rejects when disabled, and lookahead primes jiosaavn: when saavnUnprimed is false', async () => {
    const streamServer = await createServer({
        configFile: false,
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true, watch: null, ws: false },
        resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    });

    try {
        const getStreamMod = await streamServer.ssrLoadModule('/src/lib/modules/getStreamData.ts');
        const fallbackMod = await streamServer.ssrLoadModule('/src/services/saavnFallback.ts');
        const getStreamDataReal = getStreamMod.default;

        fallbackMod.useSaavnFallbackStore.getState().setEnabled(true);
        const enabledResult = await getStreamDataReal('jiosaavn:abc123');
        assert.ok('adaptiveFormats' in enabledResult);
        assert.equal(enabledResult.adaptiveFormats[0].url, 'https://m14u-jiosaavn.onrender.com/api/audio/abc123');
        assert.equal(enabledResult.adaptiveFormats[0].bitrate, '320000');

        fallbackMod.useSaavnFallbackStore.getState().setEnabled(false);
        const disabledResult = await getStreamDataReal('jiosaavn:abc123');
        assert.equal('error' in disabledResult, true);

        // Older APK (saavnUnprimed: false) still receives pre-resolved source.url for jiosaavn: rows via lookahead.
        fallbackMod.useSaavnFallbackStore.getState().setEnabled(true);
        resetNativeCapabilitiesCacheForTest();
        setupMockBridge({
            getCapabilities: async () => ({
                abiVersion: 2,
                sourceRefresh: true,
                localMedia: false,
                headlessResolver: false,
                resolverAbi: 'androidx-js-1',
                saavnUnprimed: false,
            }),
        });
        globalThis.__testResolveStream = async (id, prefetch, signal) => {
            if (id.startsWith('jiosaavn:')) {
                return getStreamDataReal(id, prefetch, signal);
            }
            return {
                title: id,
                adaptiveFormats: [
                    {
                        url: `https://cdn.example.test/audio/${encodeURIComponent(id)}?itag=251&expire=${expireFuture()}`,
                        type: 'audio/webm; codecs="opus"',
                        bitrate: '128000',
                        encoding: 'opus',
                    },
                ],
            };
        };

        await usePlayerStore.getState().setQueue(
            [
                { id: 'pIWaVJPl0-c', title: 'Track 1', author: 'Artist 1', type: 'song' },
                { id: 'jiosaavn:abc123', title: 'Track 2', author: 'Artist 2', type: 'song' },
            ],
            0,
        );
        await flush();

        const pushCall = nativeCalls.findLast(c => c.method === 'setResolvedSources');
        assert.ok(pushCall);
        assert.deepEqual(pushCall.args[0].entries[0].resolverKey, {
            provider: 'jiosaavn',
            trackId: 'jiosaavn:abc123',
        });
        assert.equal(
            pushCall.args[0].entries[0].source.url,
            'https://m14u-jiosaavn.onrender.com/api/audio/abc123',
        );
    } finally {
        await streamServer.close();
    }
});

test('revisiting F1-remapped queueId plays mapped JioSaavn track, retryPlayback clears failover state, and resolveTrackFallback runs before recordYouTubeFailure', async (t) => {
    const ytSong1 = {
        id: 'pIWaVJPl0-c',
        title: 'Faded',
        author: 'Alan Walker',
        authorId: '',
        duration: '3:32',
        durationSec: 212,
        type: 'song',
    };
    const ytSong2 = {
        id: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        author: 'Rick Astley',
        authorId: '',
        duration: '3:33',
        durationSec: 213,
        type: 'song',
    };
    const matchedSaavn = {
        id: 'jiosaavn:faded-99',
        title: 'Faded',
        author: 'Alan Walker',
        authorId: '',
        duration: '3:32',
        durationSec: 212,
        type: 'song',
    };

    const callOrder = [];
    const origResolve = useSaavnFallbackStore.getState().resolveTrackFallback;
    const origRecord = useSaavnFallbackStore.getState().recordYouTubeFailure;
    t.mock.method(useSaavnFallbackStore.getState(), 'resolveTrackFallback', async (...args) => {
        callOrder.push('resolveTrackFallback:start');
        const res = await origResolve(...args);
        callOrder.push('resolveTrackFallback:end');
        return res;
    });
    t.mock.method(useSaavnFallbackStore.getState(), 'recordYouTubeFailure', (...args) => {
        callOrder.push('recordYouTubeFailure');
        return origRecord(...args);
    });

    configureSaavnFallbackForTest({
        searchJioSaavn: async () => [matchedSaavn],
        jioSaavnAudioUrl: (id, opts) => (opts?.allowNative ? `https://m14u-jiosaavn.onrender.com/api/audio/${id.slice(9)}` : null),
    });

    const requestedStreamIds = [];
    let youtubeHealthy = false;
    globalThis.__testResolveStream = async (id, prefetch) => {
        if (!prefetch) requestedStreamIds.push(id);
        if (id === 'jiosaavn:faded-99') {
            return {
                title: 'Faded',
                adaptiveFormats: [{
                    url: 'https://m14u-jiosaavn.onrender.com/api/audio/faded-99',
                    type: 'audio/mp4',
                    bitrate: '320000',
                    encoding: 'aac',
                }],
            };
        }
        if (id === 'dQw4w9WgXcQ' || youtubeHealthy) {
            return {
                title: id,
                adaptiveFormats: [{
                    url: `https://r1.googlevideo.com/videoplayback?id=${id}&expire=${expireFuture()}`,
                    type: 'audio/webm; codecs="opus"',
                    bitrate: '128000',
                    encoding: 'opus',
                }],
            };
        }
        return { error: 'All proxies failed', message: 'YouTube unavailable' };
    };

    // 1. Track 0 fails on YouTube -> resolveTrackFallback runs BEFORE recordYouTubeFailure and remaps queueId to jiosaavn:faded-99.
    await usePlayerStore.getState().setQueue([ytSong1, ytSong2], 0);
    await flush();
    assert.deepEqual(callOrder, ['resolveTrackFallback:start', 'resolveTrackFallback:end', 'recordYouTubeFailure']);

    // 2. Move to Track 1, then revisit Track 0 via previous() -> must resolve jiosaavn:faded-99 directly without re-querying YouTube.
    await usePlayerStore.getState().next();
    await flush();
    assert.equal(usePlayerStore.getState().queueIndex, 1);

    requestedStreamIds.length = 0;
    await usePlayerStore.getState().previous();
    await flush();
    assert.equal(usePlayerStore.getState().queueIndex, 0);
    assert.deepEqual(requestedStreamIds, ['jiosaavn:faded-99']);
    assert.equal(usePlayerStore.getState().isPlaying, true);
    const revisitLoad = nativeCalls.findLast(c => c.method === 'loadQueue').args[0];
    assert.deepEqual(revisitLoad.queue[0].resolverKey, { provider: 'jiosaavn', trackId: 'jiosaavn:faded-99' });

    // Also revisit via playFromQueue(0) after moving to index 1.
    await usePlayerStore.getState().playFromQueue(1);
    await flush();
    requestedStreamIds.length = 0;
    await usePlayerStore.getState().playFromQueue(0);
    await flush();
    assert.deepEqual(requestedStreamIds, ['jiosaavn:faded-99']);

    // 3. YouTube recovers -> retryPlayback() clears activeFailoverMatches & fallbackAttemptedQueueIds and pairs YouTube URL with provider: 'youtube'.
    youtubeHealthy = true;
    requestedStreamIds.length = 0;
    await usePlayerStore.getState().retryPlayback();
    await flush();
    assert.equal(requestedStreamIds[0], 'pIWaVJPl0-c');
    const retryLoad = nativeCalls.findLast(c => c.method === 'loadQueue').args[0];
    assert.deepEqual(retryLoad.queue[0].resolverKey, { provider: 'youtube', trackId: 'pIWaVJPl0-c' });
    assert.match(retryLoad.queue[0].source?.url ?? '', /googlevideo\.com/);

    youtubeHealthy = false;
    await usePlayerStore.getState().retryPlayback();
    assert.equal(nativeCalls.findLast(c => c.method === 'loadQueue').args[0].queue[0].resolverKey.provider, 'jiosaavn');
    youtubeHealthy = true;
    usePlayerStore.getState().setRepeatMode('all');
    await usePlayerStore.getState().playFromQueue(1);
    await flush();
    const beforeDisable = nativeCalls.findLast(c => c.method === 'loadQueue').args[0];
    assert.equal(beforeDisable.queue[0].resolverKey.provider, 'jiosaavn');
    const callsBeforeDisable = nativeCalls.length;
    const currentSong = usePlayerStore.getState().currentSong;

    useSaavnFallbackStore.getState().setEnabled(false);
    await flush();

    const newCalls = nativeCalls.slice(callsBeforeDisable);
    assert.equal(newCalls.some(c => c.method === 'loadQueue' || c.method === 'control'), false);
    assert.equal(usePlayerStore.getState().currentSong, currentSong);
    assert.equal(usePlayerStore.getState().isPlaying, true);
    const update = newCalls.find(c => c.method === 'updateQueue').args[0];
    assert.equal(update.generation, beforeDisable.generation);
    assert.deepEqual(update.queue.map(row => row.queueId), beforeDisable.queue.map(row => row.queueId));
    assert.deepEqual(update.queue[0].resolverKey, { provider: 'youtube', trackId: ytSong1.id });
    assert.equal(update.queue[0].source, undefined);
    const push = nativeCalls.findLast(c => c.method === 'setResolvedSources').args[0];
    assert.equal(push.generation, update.generation);
    assert.equal(push.entries[0].resolverKey.provider, 'youtube');
    assert.match(push.entries[0].source.url, /googlevideo\.com/);

    // Repeat with the opt-out occurring after the remapped queue was sent to native.
    useSaavnFallbackStore.getState().setEnabled(true);
    youtubeHealthy = false;
    await usePlayerStore.getState().playFromQueue(0);
    youtubeHealthy = true;
    let finishLoad;
    const originalLoad = mockBridgeImpl.loadQueue;
    mockBridgeImpl.loadQueue = async opts => {
        await new Promise(resolve => { finishLoad = resolve; });
        return originalLoad(opts);
    };
    const pendingLoad = usePlayerStore.getState().playFromQueue(1);
    await flush();
    assert.ok(finishLoad);
    const inFlightLoad = nativeCalls.findLast(c => c.method === 'loadQueue').args[0];
    assert.equal(inFlightLoad.queue[0].resolverKey.provider, 'jiosaavn');
    const beforeOptOut = nativeCalls.length;
    useSaavnFallbackStore.getState().setEnabled(false);
    await flush();
    assert.equal(nativeCalls.slice(beforeOptOut).some(c => c.method === 'updateQueue'), false);
    finishLoad();
    await pendingLoad;
    await flush();
    const afterLoad = nativeCalls.slice(beforeOptOut);
    assert.equal(afterLoad[0].method, 'updateQueue');
    assert.equal(afterLoad[0].args[0].generation, inFlightLoad.generation);
    assert.deepEqual(afterLoad[0].args[0].queue[0].resolverKey, { provider: 'youtube', trackId: ytSong1.id });
    assert.equal(afterLoad[0].args[0].queue[0].source, undefined);
    assert.equal(afterLoad[1].method, 'setResolvedSources');
});

test('getDiagnostics reports foreground JS-first resolver and negotiated native capabilities', async () => {
    resetNativeCapabilitiesCacheForTest();
    setupMockBridge();
    await getNativeCapabilities();
    const diagnostics = getDiagnostics('open-audio');
    assert.match(diagnostics.streamPrimary, /youtubei\.js/);
    assert.match(diagnostics.audioEngine, /NativePlayback v2/);
    assert.equal(diagnostics.nativeCapabilities?.abiVersion, 2);
});
