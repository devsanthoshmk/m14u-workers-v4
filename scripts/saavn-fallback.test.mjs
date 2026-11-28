import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Capacitor } from '@capacitor/core';
import { createServer } from 'vite';

const storageMap = new Map();
globalThis.localStorage = {
    getItem: (key) => (storageMap.has(key) ? storageMap.get(key) : null),
    setItem: (key, value) => { storageMap.set(key, String(value)); },
    removeItem: (key) => { storageMap.delete(key); },
};

const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null, ws: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
after(() => server.close());

const { jioSaavnAudioUrl, searchJioSaavn } = await server.ssrLoadModule('/src/services/jiosaavn.ts');
const {
    BACKOFF_STEPS_MS,
    WINDOW_MS,
    configureSaavnFallbackForTest,
    findConfidentSaavnMatch,
    raceWithSignal,
    resetSaavnFallbackDepsForTest,
    useSaavnFallbackStore,
} = await server.ssrLoadModule('/src/services/saavnFallback.ts');

function makeCandidate(overrides = {}) {
    return {
        id: 'jiosaavn:abc123',
        title: 'Faded',
        author: 'Alan Walker',
        authorId: '',
        duration: '3:32',
        durationSec: 212,
        type: 'song',
        ...overrides,
    };
}

beforeEach(() => {
    storageMap.clear();
    resetSaavnFallbackDepsForTest();
    useSaavnFallbackStore.getState().reset();
});

test('jiosaavn.ts preserves default isNative() guard and unlocks with { allowNative: true }', async (t) => {
    let nativeFlag = true;
    t.mock.method(Capacitor, 'isNativePlatform', () => nativeFlag);
    assert.equal(jioSaavnAudioUrl('jiosaavn:abc123'), null);
    assert.equal(
        jioSaavnAudioUrl('jiosaavn:abc123', { allowNative: true }),
        'https://m14u-jiosaavn.onrender.com/api/audio/abc123',
    );

    const controller = new AbortController();
    await assert.rejects(
        searchJioSaavn('Faded', controller.signal),
        /JioSaavn is only available on the website/,
    );

    t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        json: async () => ({
            success: true,
            data: {
                results: [
                    {
                        id: 'abc123',
                        name: 'Faded',
                        duration: 212,
                        artists: { primary: [{ name: 'Alan Walker' }] },
                    },
                ],
            },
        }),
    }));

    const tracks = await searchJioSaavn('Faded', controller.signal, 5, { allowNative: true });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].id, 'jiosaavn:abc123');
    assert.equal(tracks[0].title, 'Faded');

    nativeFlag = false;
    assert.equal(
        jioSaavnAudioUrl('jiosaavn:abc123'),
        'https://m14u-jiosaavn.onrender.com/api/audio/abc123',
    );
});

test('findConfidentSaavnMatch accepts clean matches and rejects mismatches', () => {
    const seed = { id: 'yt1', title: 'Faded (Official Video)', author: 'Alan Walker - Topic', durationSec: 212 };

    // Clean match within 15s
    const good = makeCandidate({ id: 'jiosaavn:good', durationSec: 220 });
    assert.equal(findConfidentSaavnMatch(seed, [good])?.id, 'jiosaavn:good');

    // Artist - Title YouTube format
    const dashSeed = { id: 'yt2', title: 'Alan Walker - Faded', author: 'Alan Walker', durationSec: 212 };
    assert.equal(findConfidentSaavnMatch(dashSeed, [good])?.id, 'jiosaavn:good');

    // Reject remix, live, cover, instrumental, sped-up, reverb when seed has none
    for (const badTitle of [
        'Faded (Remix)',
        'Faded (Live)',
        'Faded (Cover)',
        'Faded (Instrumental)',
        'Faded (Sped Up)',
        'Faded (Slowed + Reverb)',
    ]) {
        assert.equal(
            findConfidentSaavnMatch(seed, [makeCandidate({ title: badTitle })]),
            null,
            `Expected rejection for "${badTitle}"`,
        );
    }

    // Allow remix when seed itself requests remix
    const remixSeed = { id: 'yt3', title: 'Faded (Remix)', author: 'Alan Walker', durationSec: 212 };
    const remixCand = makeCandidate({ id: 'jiosaavn:remix', title: 'Faded (Remix)' });
    assert.equal(findConfidentSaavnMatch(remixSeed, [remixCand])?.id, 'jiosaavn:remix');

    // Reject duration mismatch > 15s
    assert.equal(
        findConfidentSaavnMatch(seed, [makeCandidate({ durationSec: 235 })]),
        null,
    );

    // Reject wrong artist or partial title
    assert.equal(
        findConfidentSaavnMatch(seed, [makeCandidate({ author: 'Different Artist' })]),
        null,
    );
    assert.equal(
        findConfidentSaavnMatch(seed, [makeCandidate({ title: 'Faded Away' })]),
        null,
    );
    assert.equal(
        findConfidentSaavnMatch({ id: 'yt4', title: 'Faded', author: 'Unknown', durationSec: 212 }, [good]),
        null,
    );
});

test('resolveTrackFallback returns matched stream on Android and respects offline/aborted/disabled guards', async () => {
    let nowMs = 1_000_000;
    let online = true;
    const searchCalls = [];

    configureSaavnFallbackForTest({
        now: () => nowMs,
        isNative: () => true,
        isOnline: () => online,
        searchJioSaavn: async (query, _signal, _limit, options) => {
            searchCalls.push({ query, options });
            return [makeCandidate()];
        },
        jioSaavnAudioUrl: (id, options) => (options?.allowNative ? `https://render.test/${id}` : null),
    });

    const seed = { id: 'yt_faded', title: 'Faded', author: 'Alan Walker', durationSec: 212 };
    const resolved = await useSaavnFallbackStore.getState().resolveTrackFallback(seed);
    assert.ok(resolved);
    assert.equal(resolved.matchedTrack.id, 'jiosaavn:abc123');
    assert.equal(resolved.streamUrl, 'https://render.test/jiosaavn:abc123');
    assert.equal(resolved.mimeType, 'audio/mp4');
    assert.equal(searchCalls[0].options?.allowNative, true);
    assert.equal(useSaavnFallbackStore.getState().activeTrackNotice?.matchedTitle, 'Faded');

    // Offline guard
    online = false;
    assert.equal(await useSaavnFallbackStore.getState().resolveTrackFallback(seed), null);
    online = true;

    // Aborted guard
    const ac = new AbortController();
    ac.abort();
    assert.equal(await useSaavnFallbackStore.getState().resolveTrackFallback(seed, { signal: ac.signal }), null);

    // Already jiosaavn guard
    assert.equal(
        await useSaavnFallbackStore.getState().resolveTrackFallback({ ...seed, id: 'jiosaavn:abc123' }),
        null,
    );

    // Disabled guard
    useSaavnFallbackStore.getState().setEnabled(false);
    assert.equal(await useSaavnFallbackStore.getState().resolveTrackFallback(seed), null);
});

test('F3 circuit opens only on 3 distinct track failures within 5m when JioSaavn is reachable, and ignores duplicates/aborts/offline', async () => {
    let nowMs = 10_000;
    let online = true;
    let saavnShouldSucceed = false;

    configureSaavnFallbackForTest({
        now: () => nowMs,
        isNative: () => true,
        isOnline: () => online,
        searchJioSaavn: async () => {
            if (!saavnShouldSucceed) throw new Error('JioSaavn unreachable');
            return [];
        },
    });

    const store = useSaavnFallbackStore.getState;

    // Aborted and offline failures (including plain string errors from native) are ignored
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', aborted: true }).opened, false);
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', error: new DOMException('Aborted', 'AbortError') }).opened, false);
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', error: 'Native resolver request failed' }).opened, false);
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', error: 'UnknownHostException: dns failed' }).opened, false);
    online = false;
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', error: new Error('fail') }).opened, false);
    online = true;
    assert.equal(store().recentFailures.length, 0);

    // 1st distinct failure
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', error: new Error('fail 1') }).opened, false);
    // Duplicate retry of t1 does not increment
    assert.equal(store().recordYouTubeFailure({ trackId: 't1', error: new Error('fail 1b') }).opened, false);
    assert.equal(store().recentFailures.length, 1);

    // Advance past 5m window -> t1 expires
    nowMs += WINDOW_MS + 1000;
    assert.equal(store().recordYouTubeFailure({ trackId: 't2', error: new Error('fail 2') }).opened, false);
    assert.equal(store().recentFailures.length, 1);

    // 2nd and 3rd distinct failures while JioSaavn is unreachable -> circuit stays in 'youtube'
    nowMs += 10_000;
    assert.equal(store().recordYouTubeFailure({ trackId: 't3', error: new Error('fail 3') }).opened, false);
    nowMs += 10_000;
    const thirdUnreachable = store().recordYouTubeFailure({ trackId: 't4', error: new Error('fail 4') });
    assert.equal(thirdUnreachable.opened, false);
    assert.equal(store().mode, 'youtube');
    assert.equal(store().recentFailures.length, 3);

    // Once JioSaavn responds (even with 0 matches), lastAlternateReachableAt is recorded and next failure opens circuit
    saavnShouldSucceed = true;
    await store().resolveTrackFallback({ id: 't4', title: 'No Match', author: 'Artist' });
    assert.equal(store().lastAlternateReachableAt, nowMs);

    nowMs += 1000;
    const fourthReachable = store().recordYouTubeFailure({ trackId: 't5', error: new Error('fail 5') });
    assert.equal(fourthReachable.opened, true);
    assert.equal(store().mode, 'jiosaavn-fallback');
    assert.equal(store().sessionBannerVisible, true);
    assert.equal(store().backoffStep, 0);
    assert.equal(store().cooldownUntil, nowMs + BACKOFF_STEPS_MS[0]);
});

test('half-open probe is single-flight, backs off 3m -> 6m -> 10m, and retryYouTube restores youtube', async () => {
    let nowMs = 1_000_000;
    let online = true;
    let hidden = false;
    let probeCalls = 0;
    let probeShouldSucceed = false;
    let releaseProbe;

    configureSaavnFallbackForTest({
        now: () => nowMs,
        isNative: () => true,
        isOnline: () => online,
        isHidden: () => hidden,
        probeYouTubeHealth: () => {
            probeCalls += 1;
            return new Promise((resolve, reject) => {
                releaseProbe = () => (probeShouldSucceed ? resolve() : reject(new Error('YouTube still down')));
            });
        },
    });

    const store = useSaavnFallbackStore.getState;
    store().recordYouTubeFailure({ trackId: 't1', error: new Error('1') });
    store().recordYouTubeFailure({ trackId: 't2', error: new Error('2') });
    store().recordYouTubeFailure({ trackId: 't3', error: new Error('3'), alternateReachable: true });
    assert.equal(store().mode, 'jiosaavn-fallback');
    assert.equal(store().cooldownUntil, nowMs + 3 * 60_000);

    // Before cooldown: no probe
    assert.equal(await store().maybeProbeRecovery(), false);
    assert.equal(probeCalls, 0);

    // After 3m cooldown, but hidden: no probe
    nowMs += 3 * 60_000;
    hidden = true;
    assert.equal(await store().maybeProbeRecovery(), false);
    assert.equal(probeCalls, 0);
    hidden = false;

    // Single-flight concurrent probes -> only 1 probeYouTubeHealth call
    const p1 = store().maybeProbeRecovery();
    const p2 = store().maybeProbeRecovery();
    assert.equal(probeCalls, 1);
    assert.equal(store().probing, true);
    releaseProbe();
    assert.deepEqual(await Promise.all([p1, p2]), [false, false]);
    assert.equal(store().probing, false);
    assert.equal(store().backoffStep, 1);
    assert.equal(store().cooldownUntil, nowMs + 6 * 60_000);

    // 2nd probe fails -> backs off to 10m
    nowMs += 6 * 60_000;
    const p3 = store().maybeProbeRecovery();
    releaseProbe();
    assert.equal(await p3, false);
    assert.equal(store().backoffStep, 2);
    assert.equal(store().cooldownUntil, nowMs + 10 * 60_000);

    // Manual retryYouTube ignores cooldown and restores youtube on success
    probeShouldSucceed = true;
    const p4 = store().retryYouTube();
    releaseProbe();
    assert.equal(await p4, true);
    assert.equal(store().mode, 'youtube');
    assert.equal(store().sessionBannerVisible, false);
    assert.equal(store().cooldownUntil, null);
    assert.equal(store().backoffStep, 0);
    assert.equal(store().recentFailures.length, 0);
    assert.equal(store().sessionRestoredNotice, 'YouTube playback restored');
});

test('C2: mid-probe reset() and setEnabled(false) abort probe, prevent stale commits, and preserve single-flight', async () => {
    let nowMs = 2_000_000;
    const probeSignals = [];
    const resolvers = [];

    configureSaavnFallbackForTest({
        now: () => nowMs,
        isNative: () => true,
        isOnline: () => true,
        isHidden: () => false,
        probeYouTubeHealth: (signal) => {
            probeSignals.push(signal);
            return new Promise((resolve, reject) => {
                resolvers.push({ resolve, reject });
            });
        },
    });

    const store = useSaavnFallbackStore.getState;
    store().recordYouTubeFailure({ trackId: 'a1', error: new Error('1') });
    store().recordYouTubeFailure({ trackId: 'a2', error: new Error('2') });
    store().recordYouTubeFailure({ trackId: 'a3', error: new Error('3'), alternateReachable: true });
    assert.equal(store().mode, 'jiosaavn-fallback');

    // Start probe #1, then call setEnabled(false) mid-probe
    const p1 = store().retryYouTube();
    assert.equal(probeSignals[0].aborted, false);
    store().setEnabled(false);
    assert.equal(probeSignals[0].aborted, true);
    assert.equal(store().probing, false);
    assert.equal(store().enabled, false);

    // Settling probe #1 must NOT overwrite disabled state or set sessionRestoredNotice
    resolvers[0].resolve();
    assert.equal(await p1, false);
    assert.equal(store().enabled, false);
    assert.equal(store().mode, 'youtube');
    assert.equal(store().sessionRestoredNotice, null);

    // Re-enable, open circuit, start probe #2, then reset() mid-probe, then start probe #3
    store().setEnabled(true);
    store().recordYouTubeFailure({ trackId: 'b1', error: new Error('1') });
    store().recordYouTubeFailure({ trackId: 'b2', error: new Error('2') });
    store().recordYouTubeFailure({ trackId: 'b3', error: new Error('3'), alternateReachable: true });

    const p2 = store().retryYouTube();
    assert.equal(probeSignals[1].aborted, false);
    store().reset();
    assert.equal(probeSignals[1].aborted, true);
    assert.equal(store().probing, false);

    // Re-open circuit and start probe #3 while probe #2 has not yet settled
    store().recordYouTubeFailure({ trackId: 'c1', error: new Error('1') });
    store().recordYouTubeFailure({ trackId: 'c2', error: new Error('2') });
    store().recordYouTubeFailure({ trackId: 'c3', error: new Error('3'), alternateReachable: true });
    const p3 = store().retryYouTube();
    assert.equal(store().probing, true);

    // Probe #2 settles with error — MUST NOT clear probe #3's probing/single-flight or overwrite state
    resolvers[1].reject(new Error('stale probe error'));
    assert.equal(await p2, false);
    assert.equal(store().probing, true);
    assert.equal(store().lastError, '3');

    // Concurrent call while probe #3 is in flight must reuse probe #3 (single-flight)
    const p3Dup = store().retryYouTube();
    assert.equal(probeSignals.length, 3);
    resolvers[2].resolve();
    assert.deepEqual(await Promise.all([p3, p3Dup]), [true, true]);
    assert.equal(store().mode, 'youtube');
    assert.equal(store().probing, false);
});

test('M5: resolveTrackFallback aborts cleanly if fallback is disabled mid-search', async () => {
    let releaseSearch;
    configureSaavnFallbackForTest({
        now: () => 3_000_000,
        isNative: () => true,
        isOnline: () => true,
        searchJioSaavn: () => new Promise((resolve) => {
            releaseSearch = () => resolve([makeCandidate()]);
        }),
        jioSaavnAudioUrl: (id, options) => (options?.allowNative ? `https://render.test/${id}` : null),
    });

    const pending = useSaavnFallbackStore.getState().resolveTrackFallback({
        id: 'yt_mid_disable',
        title: 'Faded',
        author: 'Alan Walker',
        durationSec: 212,
    });

    useSaavnFallbackStore.getState().setEnabled(false);
    releaseSearch();

    assert.equal(await pending, null);
    assert.equal(useSaavnFallbackStore.getState().activeTrackNotice, null);
    assert.equal(useSaavnFallbackStore.getState().lastAlternateReachableAt, null);
});

for (const [label, invalidate] of [
    ['reset', store => store.reset()],
    ['disable and re-enable', store => { store.setEnabled(false); store.setEnabled(true); }],
]) {
    test(`stale fallback search cannot update reachability or notice after ${label}`, async () => {
        let completeSearch;
        configureSaavnFallbackForTest({
            isNative: () => true,
            isOnline: () => true,
            searchJioSaavn: () => new Promise(resolve => { completeSearch = resolve; }),
        });
        const state = useSaavnFallbackStore.getState;
        const pending = state().resolveTrackFallback({ id: 'yt1', title: 'Faded', author: 'Alan Walker' });
        invalidate(state());
        assert.equal(state().enabled, true);
        completeSearch([makeCandidate()]);

        assert.equal(await pending, null);
        assert.equal(state().lastAlternateReachableAt, null);
        assert.equal(state().activeTrackNotice, null);
    });
}

test('M4: raceWithSignal rejects stalled requests immediately when probe signal aborts', async () => {
    const stalled = new Promise(() => {});
    const ac = new AbortController();
    const raced = raceWithSignal(stalled, ac.signal);
    ac.abort(new DOMException('Probe timed out', 'TimeoutError'));
    await assert.rejects(raced, { name: 'TimeoutError' });
});

test('getStreamData extraction error triggers F3 when JioSaavn is reachable, and failed search clears lastAlternateReachableAt', async () => {
    let nowMs = 4_000_000;
    let saavnReachable = true;

    configureSaavnFallbackForTest({
        now: () => nowMs,
        isNative: () => true,
        isOnline: () => true,
        searchJioSaavn: async () => {
            if (!saavnReachable) throw new Error('JioSaavn 503');
            return [makeCandidate()];
        },
        jioSaavnAudioUrl: (id, options) => (options?.allowNative ? `https://render.test/${id}` : null),
    });

    const store = useSaavnFallbackStore.getState;
    const ytErr = new Error('No audio stream provider responded with a playable stream');

    // Track 1: extraction fails, JioSaavn fallback succeeds -> lastAlternateReachableAt set
    assert.ok(await store().resolveTrackFallback({ id: 'yt1', title: 'Faded', author: 'Alan Walker', durationSec: 212 }));
    assert.equal(store().lastAlternateReachableAt, nowMs);
    assert.equal(store().recordYouTubeFailure({ trackId: 'yt1', error: ytErr }).opened, false);

    // Track 2: extraction fails, JioSaavn search fails -> lastAlternateReachableAt cleared
    nowMs += 5_000;
    saavnReachable = false;
    assert.equal(await store().resolveTrackFallback({ id: 'yt2', title: 'Faded', author: 'Alan Walker', durationSec: 212 }), null);
    assert.equal(store().lastAlternateReachableAt, null);
    assert.equal(store().recordYouTubeFailure({ trackId: 'yt2', error: ytErr }).opened, false);

    // Track 3: extraction fails while JioSaavn is still unreachable -> circuit stays 'youtube'
    nowMs += 5_000;
    const thirdUnreachable = store().recordYouTubeFailure({ trackId: 'yt3', error: ytErr });
    assert.equal(thirdUnreachable.opened, false);
    assert.equal(store().mode, 'youtube');
    assert.equal(store().recentFailures.length, 3);

    // Track 4: JioSaavn recovers -> resolveTrackFallback succeeds and next extraction failure opens F3
    nowMs += 5_000;
    saavnReachable = true;
    assert.ok(await store().resolveTrackFallback({ id: 'yt4', title: 'Faded', author: 'Alan Walker', durationSec: 212 }));
    assert.equal(store().lastAlternateReachableAt, nowMs);
    const fourthReachable = store().recordYouTubeFailure({ trackId: 'yt4', error: ytErr });
    assert.equal(fourthReachable.opened, true);
    assert.equal(store().mode, 'jiosaavn-fallback');
});
