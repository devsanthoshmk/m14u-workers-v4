import type { AudioStream, TrackItem } from '@/types/music';
import { isJioSaavnTrack } from '@/services/jiosaavn';
import type {
    NativeResolvedSourceEntry,
    NativeResolverKey,
    NativeSetResolvedSourcesResult,
    NativeTrackSource,
} from '@/plugins/NativePlayback';

export const EXPIRY_SAFETY_MARGIN_MS = 30_000;
export const MAX_SOURCE_TTL_MS = 5 * 60_000;
export const UNKNOWN_EXPIRY_TTL_MS = 4 * 60_000;
export const LOOKAHEAD_FRESH_MARGIN_MS = 45_000;
export const DEFAULT_LOOKAHEAD_COUNT = 2;

export type LookaheadRepeatMode = 'off' | 'all' | 'one' | 'none';

export interface LookaheadQueueRow {
    queueId: string;
    song: TrackItem;
}

export interface StreamResolutionPayload {
    adaptiveFormats: AudioStream[];
    streamProxy?: string;
}

export type StreamResolverFn = (
    id: string,
    prefetch?: boolean,
    signal?: AbortSignal,
) => Promise<StreamResolutionPayload | Record<'error' | 'message', string>>;

export interface LookaheadStateSnapshot {
    queue: LookaheadQueueRow[];
    queueIndex: number;
    repeatMode: LookaheadRepeatMode;
    generation: number;
    isActive: boolean;
}

export interface LookaheadManagerDeps {
    getState: () => LookaheadStateSnapshot;
    resolveStream: StreamResolverFn;
    pushResolvedSources: (
        generation: number,
        entries: NativeResolvedSourceEntry[],
    ) => Promise<NativeSetResolvedSourcesResult | null>;
    selectStream?: (
        streams: AudioStream[],
        quality: string,
    ) => AudioStream | undefined | Promise<AudioStream | undefined>;
    proxyUrl?: (url: string, proxy: string) => string;
    getQuality?: () => string;
    resolveRowTrackId?: (row: LookaheadQueueRow) => string;
    now?: () => number;
    maxCount?: number;
}

function stripControlChars(value: string): string {
    let out = '';
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code > 0x1f && code !== 0x7f) {
            out += value[i];
        }
    }
    return out;
}

export function buildResolverKey(trackId: string): NativeResolverKey | undefined {
    const cleanId = stripControlChars(trackId).trim();
    if (!cleanId) return undefined;

    if (isJioSaavnTrack(cleanId)) {
        return { provider: 'jiosaavn', trackId: cleanId.slice(0, 128) };
    }
    if (/^(archive|commons|audius|openverse|freetouse):/.test(cleanId)) {
        return { provider: 'open-audio', trackId: cleanId.slice(0, 128) };
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(cleanId)) {
        return { provider: 'youtube', trackId: cleanId };
    }
    return { provider: 'custom', trackId: cleanId.slice(0, 128) };
}

export function computeSourceExpiryMs(url: string, now: number = Date.now()): number | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'https:') {
        return null;
    }

    const rawExpire = parsed.searchParams.get('expire');
    if (rawExpire !== null && rawExpire !== '') {
        const expireSec = Number(rawExpire);
        if (Number.isFinite(expireSec) && expireSec > 0) {
            const safeExpiryMs = expireSec * 1000 - EXPIRY_SAFETY_MARGIN_MS;
            if (safeExpiryMs <= now) {
                return null;
            }
            return Math.min(safeExpiryMs, now + MAX_SOURCE_TTL_MS);
        }
    }

    return now + UNKNOWN_EXPIRY_TTL_MS;
}

export function selectLookaheadQueueItems(
    queue: LookaheadQueueRow[],
    queueIndex: number,
    repeatMode: LookaheadRepeatMode,
    maxCount: number = DEFAULT_LOOKAHEAD_COUNT,
): LookaheadQueueRow[] {
    if (!queue.length || queueIndex < 0 || queueIndex >= queue.length || maxCount <= 0) {
        return [];
    }
    if (repeatMode === 'one') {
        return [];
    }

    const activeQueueId = queue[queueIndex].queueId;
    const seenQueueIds = new Set<string>([activeQueueId]);
    const selected: LookaheadQueueRow[] = [];

    const limit = Math.min(maxCount, queue.length);
    for (let step = 1; step <= limit; step++) {
        let idx = queueIndex + step;
        if (idx >= queue.length) {
            if (repeatMode === 'all') {
                idx = idx % queue.length;
            } else {
                break;
            }
        }

        const row = queue[idx];
        if (!row || seenQueueIds.has(row.queueId)) {
            continue;
        }
        seenQueueIds.add(row.queueId);
        selected.push(row);
        if (selected.length >= maxCount) {
            break;
        }
    }

    return selected;
}

export interface LookaheadManager {
    prime: () => Promise<void>;
    cancel: () => void;
    reset: () => void;
    markFresh: (generation: number, queueId: string, trackId: string, expiresAtMs: number) => void;
    isFresh: (generation: number, queueId: string, trackId: string) => boolean;
}

export function createLookaheadManager(deps: LookaheadManagerDeps): LookaheadManager {
    const now = deps.now ?? Date.now;
    const maxCount = deps.maxCount ?? DEFAULT_LOOKAHEAD_COUNT;
    const getRowTrackId = (row: LookaheadQueueRow) =>
        deps.resolveRowTrackId ? deps.resolveRowTrackId(row) : row.song.id;

    let inFlightController: AbortController | null = null;
    let inFlightKey = '';

    const freshSources = new Map<string, { generation: number; trackId: string; expiresAtMs: number }>();

    function pruneFresh(activeGeneration: number) {
        const currentTime = now();
        for (const [queueId, entry] of freshSources) {
            if (entry.generation !== activeGeneration || entry.expiresAtMs <= currentTime) {
                freshSources.delete(queueId);
            }
        }
    }

    function isFresh(generation: number, queueId: string, trackId: string): boolean {
        const entry = freshSources.get(queueId);
        if (!entry) return false;
        if (entry.generation !== generation || entry.trackId !== trackId) return false;
        return entry.expiresAtMs - now() > LOOKAHEAD_FRESH_MARGIN_MS;
    }

    function markFresh(generation: number, queueId: string, trackId: string, expiresAtMs: number): void {
        if (generation <= 0 || !queueId || !trackId || expiresAtMs <= now()) return;
        freshSources.set(queueId, { generation, trackId, expiresAtMs });
    }

    function cancel(): void {
        if (inFlightController) {
            inFlightController.abort();
            inFlightController = null;
        }
        inFlightKey = '';
    }

    function reset(): void {
        cancel();
        freshSources.clear();
    }

    function isGenerationStillActive(expectedGeneration: number): boolean {
        const latest = deps.getState();
        return latest.isActive && latest.generation === expectedGeneration;
    }

    async function prime(): Promise<void> {
        const snapshot = deps.getState();
        if (!snapshot.isActive || snapshot.generation <= 0) {
            cancel();
            return;
        }

        const generation = snapshot.generation;
        pruneFresh(generation);

        const candidates = selectLookaheadQueueItems(
            snapshot.queue,
            snapshot.queueIndex,
            snapshot.repeatMode,
            maxCount,
        );
        const needed = candidates.filter((row) => !isFresh(generation, row.queueId, getRowTrackId(row)));

        if (needed.length === 0) {
            cancel();
            return;
        }

        const batchKey = `${generation}:${needed.map((row) => row.queueId).join(',')}`;
        if (inFlightController && inFlightKey === batchKey) {
            return;
        }

        cancel();
        const controller = new AbortController();
        inFlightController = controller;
        inFlightKey = batchKey;

        try {
            const entries: NativeResolvedSourceEntry[] = [];
            const resolvedByTrackId = new Map<string, NativeTrackSource | null>();

            for (const row of needed) {
                if (controller.signal.aborted || !isGenerationStillActive(generation)) {
                    return;
                }

                const trackId = getRowTrackId(row);
                let source = resolvedByTrackId.get(trackId);

                if (source === undefined) {
                    source = null;
                    try {
                        const data = await deps.resolveStream(trackId, true, controller.signal);
                        if (controller.signal.aborted || !isGenerationStillActive(generation)) {
                            return;
                        }

                        if (!('error' in data) && data.adaptiveFormats?.length) {
                            const audioStreams = data.adaptiveFormats.filter(
                                (s) => s?.type?.startsWith('audio/') && s.url,
                            );
                            if (audioStreams.length > 0) {
                                const selectStream = deps.selectStream ?? ((streams: AudioStream[]) => streams[0]);
                                const quality = deps.getQuality ? deps.getQuality() : 'medium';
                                const chosen = await selectStream(audioStreams, quality);
                                if (controller.signal.aborted || !isGenerationStillActive(generation)) {
                                    return;
                                }
                                if (chosen?.url) {
                                    const applyProxy = deps.proxyUrl ?? ((url: string) => url);
                                    const streamUrl = applyProxy(chosen.url, data.streamProxy || '');
                                    const expiresAtMs = computeSourceExpiryMs(streamUrl, now());
                                    if (expiresAtMs !== null) {
                                        source = {
                                            url: streamUrl,
                                            ...(chosen.type ? { mimeType: chosen.type } : {}),
                                            expiresAtMs,
                                        };
                                    }
                                }
                            }
                        }
                    } catch {
                        if (controller.signal.aborted || !isGenerationStillActive(generation)) {
                            return;
                        }
                        source = null;
                    }
                    resolvedByTrackId.set(trackId, source);
                }

                if (source) {
                    const resolverKey = buildResolverKey(trackId);
                    entries.push({
                        queueId: row.queueId,
                        ...(resolverKey ? { resolverKey } : {}),
                        source: { ...source },
                    });
                }
            }

            if (controller.signal.aborted || !isGenerationStillActive(generation) || entries.length === 0) {
                return;
            }

            const result = await deps.pushResolvedSources(generation, entries);
            if (controller.signal.aborted || !isGenerationStillActive(generation)) {
                return;
            }

            if (result && result.updated > 0 && result.rejected === 0) {
                for (const entry of entries) {
                    const row = needed.find((item) => item.queueId === entry.queueId);
                    if (row && entry.source.expiresAtMs) {
                        markFresh(generation, entry.queueId, getRowTrackId(row), entry.source.expiresAtMs);
                    }
                }
            }
        } catch {
            // Lookahead is best-effort prefetch and never surfaces UI playback errors.
        } finally {
            if (inFlightController === controller) {
                inFlightController = null;
                inFlightKey = '';
            }
        }
    }

    return {
        prime,
        cancel,
        reset,
        markFresh,
        isFresh,
    };
}
