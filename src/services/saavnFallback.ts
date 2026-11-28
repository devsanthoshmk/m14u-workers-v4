import { create } from 'zustand';
import { isNative } from '@/lib/utils/platform';
import { anyAbortSignal, timeoutAbortSignal } from '@/lib/modules/resolver/abortSignal';
import type { TrackItem } from '@/types/music';
import { isJioSaavnTrack, jioSaavnAudioUrl, searchJioSaavn } from './jiosaavn';
import { cleanArtistName, normalizeSongText } from './saavnDiscovery';

export const FAILURE_THRESHOLD = 3;
export const WINDOW_MS = 5 * 60_000;
export const BACKOFF_STEPS_MS = [3 * 60_000, 6 * 60_000, 10 * 60_000] as const;
export const PROBE_TIMEOUT_MS = 6500;
export const FALLBACK_SEARCH_TIMEOUT_MS = 8000;
const PROBE_VIDEO_ID = 'pIWaVJPl0-c';
const ENABLED_STORAGE_KEY = 'm14u-android-saavn-fallback';

export type FallbackMode = 'youtube' | 'jiosaavn-fallback';

export interface TrackFallbackNotice {
    id: number;
    title: string;
    matchedTitle: string;
    matchedArtist: string;
    timestamp: number;
}

export interface FailureRecord {
    trackId: string;
    at: number;
}

export interface FallbackTrackSeed {
    id?: string;
    title: string;
    author: string;
    durationSec?: number | null;
    duration?: string | number | null;
}

export interface ResolvedTrackFallback {
    matchedTrack: TrackItem;
    streamUrl: string;
    mimeType: 'audio/mp4';
}

export interface RecordYouTubeFailureInput {
    trackId: string;
    error?: unknown;
    aborted?: boolean;
    online?: boolean;
    alternateReachable?: boolean;
}

export interface SaavnFallbackDeps {
    now: () => number;
    isNative: () => boolean;
    isOnline: () => boolean;
    isHidden: () => boolean;
    searchJioSaavn: typeof searchJioSaavn;
    jioSaavnAudioUrl: typeof jioSaavnAudioUrl;
    probeYouTubeHealth: (signal: AbortSignal) => Promise<void>;
}

const QUALIFIER_PATTERNS: Array<[string, RegExp]> = [
    ['live', /\blive\b/i],
    ['remix', /\bremix(?:es|ed)?\b/i],
    ['cover', /\bcover(?:ed|s)?\b/i],
    ['instrumental', /\binstrumental\b/i],
    ['sped-up', /\b(?:sped[\s-]*up|speed[\s-]*up|nightcore)\b/i],
    ['reverb', /\b(?:reverb|slowed)\b/i],
    ['karaoke', /\bkaraoke\b/i],
    ['acoustic', /\bacoustic\b/i],
    ['lofi', /\b(?:lo[\s-]*fi|lofi)\b/i],
    ['mashup', /\bmashup\b/i],
    ['8d', /\b8d\b/i],
];

const BENIGN_TITLE_TAGS =
    /\s*[([](?:\s*(?:official\s+(?:music\s+)?(?:video|audio|lyric\s+video|lyrics)|lyric\s+video|lyrics|audio\s+only|full\s+(?:song|audio|video)|video\s+song|hd|4k|hq)\s*)[)\]]/gi;

const GENERIC_ARTISTS = new Set(['unknown', 'various artists', 'va']);

function extractQualifiers(title: string): Set<string> {
    const normalized = title.normalize('NFKC').toLowerCase();
    const found = new Set<string>();
    for (const [label, pattern] of QUALIFIER_PATTERNS) {
        if (pattern.test(normalized)) found.add(label);
    }
    return found;
}

function sameQualifierSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

function stripBenignTitleTags(title: string): string {
    return title.replace(BENIGN_TITLE_TAGS, ' ').trim();
}

function parseArtistTokens(author: string): string[] {
    return author
        .split(/,|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i)
        .map(part => normalizeSongText(cleanArtistName(part)))
        .filter(token => token.length > 0 && !GENERIC_ARTISTS.has(token));
}

function parseDurationSeconds(track: { durationSec?: number | null; duration?: string | number | null }): number | null {
    if (typeof track.durationSec === 'number' && Number.isFinite(track.durationSec) && track.durationSec > 0) {
        return track.durationSec;
    }
    if (typeof track.duration === 'number' && Number.isFinite(track.duration) && track.duration > 0) {
        return track.duration;
    }
    if (typeof track.duration === 'string') {
        const trimmed = track.duration.trim();
        if (!trimmed) return null;
        const parts = trimmed.split(':').map(part => Number(part));
        if ((parts.length === 2 || parts.length === 3) && parts.every(part => Number.isFinite(part) && part >= 0)) {
            const total = parts.reduce((acc, part) => acc * 60 + part, 0);
            return total > 0 ? total : null;
        }
    }
    return null;
}

function matchesNormalizedTitle(seed: FallbackTrackSeed, candidateTitle: string, seedArtists: string[]): boolean {
    const normCand = normalizeSongText(stripBenignTitleTags(candidateTitle));
    if (!normCand) return false;

    const normSeed = normalizeSongText(stripBenignTitleTags(seed.title));
    if (normSeed && normSeed === normCand) return true;

    // Handle YouTube "Artist - Title" video naming when the prefix matches a seed artist.
    const dashMatch = /^(.+?)\s+[-–—]\s+(.+)$/.exec(seed.title);
    if (dashMatch) {
        const prefix = normalizeSongText(cleanArtistName(dashMatch[1]));
        const rest = normalizeSongText(stripBenignTitleTags(dashMatch[2]));
        if (prefix && rest && seedArtists.includes(prefix) && rest === normCand) {
            return true;
        }
    }
    return false;
}

export function findConfidentSaavnMatch(seed: FallbackTrackSeed, candidates: TrackItem[]): TrackItem | null {
    const seedArtists = parseArtistTokens(seed.author);
    if (!seed.title.trim() || seedArtists.length === 0) return null;

    const seedQualifiers = extractQualifiers(seed.title);
    const seedDuration = parseDurationSeconds(seed);
    const rawNormSeedTitle = normalizeSongText(seed.title);

    let best: { track: TrackItem; score: number } | null = null;

    for (const candidate of candidates) {
        if (!candidate || !isJioSaavnTrack(candidate.id) || !candidate.title?.trim() || !candidate.author?.trim()) {
            continue;
        }

        const candQualifiers = extractQualifiers(candidate.title);
        if (!sameQualifierSet(seedQualifiers, candQualifiers)) {
            continue;
        }

        if (!matchesNormalizedTitle(seed, candidate.title, seedArtists)) {
            continue;
        }

        const candArtists = parseArtistTokens(candidate.author);
        if (candArtists.length === 0 || !seedArtists.some(artist => candArtists.includes(artist))) {
            continue;
        }

        const candDuration = parseDurationSeconds(candidate);
        if (seedDuration !== null && candDuration !== null && Math.abs(seedDuration - candDuration) > 15) {
            continue;
        }

        let score = 0;
        if (candArtists[0] === seedArtists[0]) score += 100;
        if (normalizeSongText(candidate.title) === rawNormSeedTitle) score += 20;
        if (seedDuration !== null && candDuration !== null) {
            score -= Math.abs(seedDuration - candDuration);
        }

        if (!best || score > best.score) {
            best = { track: candidate, score };
        }
    }

    return best ? best.track : null;
}

function readEnabledPreference(): boolean {
    try {
        return localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

function writeEnabledPreference(enabled: boolean): void {
    try {
        if (enabled) {
            localStorage.removeItem(ENABLED_STORAGE_KEY);
        } else {
            localStorage.setItem(ENABLED_STORAGE_KEY, 'false');
        }
    } catch {
        // Ignore storage write failures in restricted environments.
    }
}

function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const name = (error as { name?: unknown }).name;
    return name === 'AbortError' || name === 'TimeoutError';
}

const OFFLINE_ERROR_PATTERNS = [
    'offline',
    'err_internet_disconnected',
    'native resolver request failed',
    'failed to fetch',
    'networkerror',
    'network request failed',
    'unknownhostexception',
    'sockettimeoutexception',
    'connectexception',
];

function isOfflineError(error: unknown): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const raw = typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : '';
    const msg = raw.toLowerCase();
    if (!msg) return false;
    return OFFLINE_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    return 'YouTube playback failed';
}

export async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        throw (signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

async function defaultProbeYouTubeHealth(signal: AbortSignal): Promise<void> {
    const [{ resolveYouTubeStreams, configureYouTubeEvaluator }, { capacitorFetch, evaluatePlayerScript }, { CapacitorHttp }] =
        await Promise.all([
            import('@/lib/modules/resolver/core'),
            import('@/lib/modules/resolver/capacitorTransport'),
            import('@capacitor/core'),
        ]);

    configureYouTubeEvaluator(evaluatePlayerScript);
    const streams = await resolveYouTubeStreams(PROBE_VIDEO_ID, { fetch: capacitorFetch, signal });
    signal.throwIfAborted();

    const format = streams.adaptiveFormats.find(item => typeof item.url === 'string' && item.url.length > 0);
    if (!format) {
        throw new Error('YouTube probe returned no audio formats');
    }

    const mediaUrl = new URL(format.url);
    if (mediaUrl.protocol !== 'https:' || !mediaUrl.hostname.endsWith('.googlevideo.com')) {
        throw new Error('YouTube probe returned invalid media host');
    }

    const response = await raceWithSignal(
        CapacitorHttp.request({
            url: mediaUrl.href,
            method: 'GET',
            headers: { Range: 'bytes=0-0' },
            responseType: 'text',
            connectTimeout: 2500,
            readTimeout: 3500,
        }),
        signal,
    );
    signal.throwIfAborted();

    if (response.status !== 200 && response.status !== 206) {
        throw new Error(`YouTube media probe failed (${response.status})`);
    }
}

const defaultDeps: SaavnFallbackDeps = {
    now: () => Date.now(),
    isNative: () => isNative(),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    isHidden: () => (typeof document === 'undefined' ? false : document.hidden === true),
    searchJioSaavn,
    jioSaavnAudioUrl,
    probeYouTubeHealth: defaultProbeYouTubeHealth,
};

let deps: SaavnFallbackDeps = { ...defaultDeps };
let noticeCounter = 0;
let probeEpoch = 0;
let fallbackEpoch = 0;
let activeProbePromise: Promise<boolean> | null = null;
let activeProbeController: AbortController | null = null;

export function configureSaavnFallbackForTest(overrides: Partial<SaavnFallbackDeps>): void {
    deps = { ...defaultDeps, ...overrides };
}

export function resetSaavnFallbackDepsForTest(): void {
    deps = { ...defaultDeps };
    probeEpoch += 1;
    activeProbeController?.abort();
    activeProbeController = null;
    activeProbePromise = null;
}

export interface SaavnFallbackState {
    enabled: boolean;
    mode: FallbackMode;
    cooldownUntil: number | null;
    backoffStep: number;
    activeTrackNotice: TrackFallbackNotice | null;
    sessionBannerVisible: boolean;
    sessionRestoredNotice: string | null;
    probing: boolean;
    lastError: string | null;
    lastAlternateReachableAt: number | null;
    recentFailures: FailureRecord[];
    setEnabled: (enabled: boolean) => void;
    dismissTrackNotice: () => void;
    dismissSessionBanner: () => void;
    dismissRestoredNotice: () => void;
    reset: () => void;
    recordYouTubeFailure: (input: RecordYouTubeFailureInput) => { opened: boolean; mode: FallbackMode };
    resolveTrackFallback: (seed: FallbackTrackSeed, options?: { signal?: AbortSignal }) => Promise<ResolvedTrackFallback | null>;
    maybeProbeRecovery: () => Promise<boolean>;
    retryYouTube: () => Promise<boolean>;
}

const initialTransientState = () => ({
    mode: 'youtube' as FallbackMode,
    cooldownUntil: null as number | null,
    backoffStep: 0,
    activeTrackNotice: null as TrackFallbackNotice | null,
    sessionBannerVisible: false,
    sessionRestoredNotice: null as string | null,
    probing: false,
    lastError: null as string | null,
    lastAlternateReachableAt: null as number | null,
    recentFailures: [] as FailureRecord[],
});

export const useSaavnFallbackStore = create<SaavnFallbackState>((set, get) => {
    async function runRecoveryProbe(): Promise<boolean> {
        if (activeProbePromise) return activeProbePromise;

        const currentEpoch = probeEpoch;
        const controller = new AbortController();
        activeProbeController = controller;
        const timeout = timeoutAbortSignal(PROBE_TIMEOUT_MS);
        const combined = anyAbortSignal([controller.signal, timeout.signal]);

        const run = (async () => {
            set({ probing: true });
            try {
                await deps.probeYouTubeHealth(combined.signal);
                if (probeEpoch !== currentEpoch || !get().enabled) {
                    return false;
                }
                set({
                    mode: 'youtube',
                    cooldownUntil: null,
                    backoffStep: 0,
                    sessionBannerVisible: false,
                    sessionRestoredNotice: 'YouTube playback restored',
                    probing: false,
                    lastError: null,
                    recentFailures: [],
                });
                return true;
            } catch (error) {
                if (probeEpoch !== currentEpoch || !get().enabled) {
                    return false;
                }
                const state = get();
                const nextStep = Math.min(state.backoffStep + 1, BACKOFF_STEPS_MS.length - 1);
                const now = deps.now();
                set({
                    mode: 'jiosaavn-fallback',
                    backoffStep: nextStep,
                    cooldownUntil: now + BACKOFF_STEPS_MS[nextStep],
                    probing: false,
                    lastError: toErrorMessage(error),
                });
                return false;
            } finally {
                combined.cleanup();
                timeout.cleanup();
                if (probeEpoch === currentEpoch && get().enabled) {
                    activeProbePromise = null;
                    activeProbeController = null;
                    set({ probing: false });
                }
            }
        })();

        activeProbePromise = run;
        return run;
    }

    return {
        enabled: readEnabledPreference(),
        ...initialTransientState(),

        setEnabled: (enabled) => {
            writeEnabledPreference(enabled);
            if (!enabled) {
                fallbackEpoch += 1;
                probeEpoch += 1;
                activeProbeController?.abort();
                activeProbeController = null;
                activeProbePromise = null;
                set({
                    enabled: false,
                    ...initialTransientState(),
                });
                return;
            }
            set({ enabled: true });
        },

        dismissTrackNotice: () => set({ activeTrackNotice: null }),

        dismissSessionBanner: () => set({ sessionBannerVisible: false }),

        dismissRestoredNotice: () => set({ sessionRestoredNotice: null }),

        reset: () => {
            writeEnabledPreference(true);
            fallbackEpoch += 1;
            probeEpoch += 1;
            activeProbeController?.abort();
            activeProbeController = null;
            activeProbePromise = null;
            set({
                enabled: true,
                ...initialTransientState(),
            });
        },

        recordYouTubeFailure: ({ trackId, error, aborted, online, alternateReachable }) => {
            const state = get();
            if (!deps.isNative() || !state.enabled) {
                return { opened: false, mode: state.mode };
            }
            if (aborted || isAbortError(error)) {
                return { opened: false, mode: state.mode };
            }
            if (online === false || !deps.isOnline() || isOfflineError(error)) {
                return { opened: false, mode: state.mode };
            }
            if (!trackId || isJioSaavnTrack(trackId)) {
                return { opened: false, mode: state.mode };
            }

            const now = deps.now();
            const cutoff = now - WINDOW_MS;
            const pruned = state.recentFailures.filter(item => item.at >= cutoff);
            if (pruned.some(item => item.trackId === trackId)) {
                return { opened: false, mode: state.mode };
            }

            const nextFailures = [...pruned, { trackId, at: now }];
            const message = toErrorMessage(error);

            if (state.mode === 'jiosaavn-fallback') {
                set({ recentFailures: nextFailures, lastError: message });
                return { opened: false, mode: state.mode };
            }

            if (nextFailures.length >= FAILURE_THRESHOLD) {
                const alternateVerified =
                    alternateReachable === true ||
                    (state.lastAlternateReachableAt !== null && now - state.lastAlternateReachableAt <= WINDOW_MS);
                if (alternateVerified) {
                    set({
                        mode: 'jiosaavn-fallback',
                        recentFailures: nextFailures,
                        cooldownUntil: now + BACKOFF_STEPS_MS[0],
                        backoffStep: 0,
                        sessionBannerVisible: true,
                        sessionRestoredNotice: null,
                        lastError: message,
                    });
                    return { opened: true, mode: 'jiosaavn-fallback' };
                }
                set({ recentFailures: nextFailures, lastError: message });
                return { opened: false, mode: state.mode };
            }

            set({ recentFailures: nextFailures, lastError: message });
            return { opened: false, mode: state.mode };
        },

        resolveTrackFallback: async (seed, options) => {
            const state = get();
            if (
                !deps.isNative() ||
                !state.enabled ||
                !deps.isOnline() ||
                options?.signal?.aborted ||
                isJioSaavnTrack(seed.id)
            ) {
                return null;
            }

            const query = `${seed.title} ${cleanArtistName(seed.author)}`.trim();
            if (!query) return null;

            const timeout = timeoutAbortSignal(FALLBACK_SEARCH_TIMEOUT_MS);
            const combined = anyAbortSignal([options?.signal, timeout.signal]);
            const currentEpoch = fallbackEpoch;
            const isCurrent = () => fallbackEpoch === currentEpoch && get().enabled;

            try {
                const candidates = await deps.searchJioSaavn(query, combined.signal, undefined, { allowNative: true });
                if (options?.signal?.aborted || !isCurrent()) return null;

                set({ lastAlternateReachableAt: deps.now() });

                const matchedTrack = findConfidentSaavnMatch(seed, candidates);
                if (!matchedTrack) return null;

                const streamUrl = deps.jioSaavnAudioUrl(matchedTrack.id, { allowNative: true });
                if (!streamUrl) return null;

                if (!isCurrent()) return null;

                set({
                    activeTrackNotice: {
                        id: ++noticeCounter,
                        title: seed.title,
                        matchedTitle: matchedTrack.title,
                        matchedArtist: matchedTrack.author,
                        timestamp: deps.now(),
                    },
                    lastError: null,
                });

                return {
                    matchedTrack,
                    streamUrl,
                    mimeType: 'audio/mp4',
                };
            } catch (error) {
                if (isCurrent() && !options?.signal?.aborted && (timeout.signal.aborted || !isAbortError(error))) {
                    set({ lastAlternateReachableAt: null, lastError: toErrorMessage(error) });
                }
                return null;
            } finally {
                combined.cleanup();
                timeout.cleanup();
            }
        },

        maybeProbeRecovery: async () => {
            const state = get();
            if (!deps.isNative() || !state.enabled || state.mode !== 'jiosaavn-fallback') {
                return false;
            }
            if (activeProbePromise) {
                return activeProbePromise;
            }
            if (!deps.isOnline() || deps.isHidden()) {
                return false;
            }
            const now = deps.now();
            if (state.cooldownUntil !== null && now < state.cooldownUntil) {
                return false;
            }
            return runRecoveryProbe();
        },

        retryYouTube: async () => {
            const state = get();
            if (!deps.isNative()) return false;
            if (!state.enabled) return false;
            return runRecoveryProbe();
        },
    };
});
