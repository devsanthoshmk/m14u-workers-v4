import type { Song, TrackItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';
import { isNative } from '@/lib/utils/platform';
import { searchJioSaavn } from '@/services/jiosaavn';
import { normalizeMusicLanguage, normalizeMusicLanguages, rankSongsByLanguage } from '@/lib/utils/musicLanguage';
import { useListeningPreferences, MUSIC_LANGUAGES } from '@/stores/listeningPreferences';
import { usePlayerStore } from '@/stores/playerStore';
import type { WebCatalog } from '@/stores/catalogStore';
import { toTrackItem } from '@/utils/trackMetadata';
import { LOCALE_OPTIONS } from '@/utils/constants';

export const FALLBACK_OPEN_TRACKS: TrackItem[] = [
    {
        id: 'audius:ng9rl',
        title: 'Lofi Study Session',
        author: 'Lofi Sleep Chill',
        authorId: '',
        type: 'song',
        duration: '2:45',
        durationSec: 165,
        licenseLabel: 'All rights reserved / Audius Stream',
        licenseUrl: 'https://audius.co',
        sourceUrl: 'https://audius.co',
        img: 'https://creatornode.audius.co/ipfs/QmZ...',
    },
    {
        id: 'openverse:1a799f3d-527d-47f8-b222-33d4c619f94c',
        title: 'Acoustic Breeze',
        author: 'Benjamin Tissot',
        authorId: '',
        type: 'song',
        duration: '3:05',
        durationSec: 185,
        licenseLabel: 'CC BY-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
        sourceUrl: 'https://jamendo.com',
    },
    {
        id: 'freetouse:db409ac0-930a-4f4f-bff3-a63278673a6f',
        title: 'Warm Memories',
        author: 'Lukrembo',
        authorId: '',
        type: 'song',
        duration: '2:18',
        durationSec: 138,
        licenseLabel: 'Free To Use (noncommercial)',
        licenseUrl: 'https://freetouse.com/license',
        sourceUrl: 'https://freetouse.com/music',
    },
];

export async function getAndroidRecommendations(
    recentTrack?: TrackItem | Song | null,
    languageOrLanguages?: string | string[],
    signal?: AbortSignal
): Promise<{ seed: TrackItem | null; tracks: TrackItem[] }> {
    const seed = recentTrack ? toTrackItem(recentTrack) : null;
    const baseUrl = API_BASE_URL.replace(/\/+$/, '');
    const langs = normalizeMusicLanguages(languageOrLanguages);

    // 1. If we have a recent track with a valid YouTube video ID, try /api/up-next
    if (seed && /^[\w-]{11}$/.test(seed.id)) {
        try {
            const timeout = AbortSignal.timeout(6000);
            const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
            const res = await fetch(`${baseUrl}/api/up-next?id=${encodeURIComponent(seed.id)}`, {
                signal: requestSignal,
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const tracks: TrackItem[] = data
                        .filter(item => item && typeof item.id === 'string' && item.id !== seed.id)
                        .map(item => ({
                            id: item.id,
                            title: item.title || 'Unknown Track',
                            author: item.author || 'Unknown Artist',
                            authorId: '',
                            duration: item.duration || '',
                            type: 'song' as const,
                        }));
                    if (tracks.length > 0) {
                        return { seed, tracks: rankSongsByLanguage(tracks, langs) };
                    }
                }
            }
        } catch {
            // Fall through to query-based fallback
        }
    }

    // 2. Fallback search by seed author/title or language-based trending search
    const query = seed
        ? (seed.author ? `${seed.author}` : seed.title)
        : (langs.length > 0 ? `${langs.slice(0, 2).join(' ')} top hits` : 'top music');

    try {
        const timeout = AbortSignal.timeout(8000);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetch(
            `${baseUrl}/api/search?q=${encodeURIComponent(query)}&catalog=youtube&f=song`,
            { signal: requestSignal }
        );
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const tracks = (data as TrackItem[]).filter(t => t && t.id && (!seed || t.id !== seed.id));
                return { seed, tracks: rankSongsByLanguage(tracks, langs, query) };
            }
        }
    } catch {
        // Fall through
    }

    return { seed, tracks: [] };
}

export async function getOpenAudioFeatured(signal?: AbortSignal): Promise<TrackItem[]> {
    const baseUrl = API_BASE_URL.replace(/\/+$/, '');
    try {
        const timeout = AbortSignal.timeout(7000);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetch(`${baseUrl}/api/search-discovery`, { signal: requestSignal });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.tracks) && data.tracks.length > 0) {
                return data.tracks as TrackItem[];
            }
        }
    } catch {
        // Use truthful fallback tracks
    }
    return FALLBACK_OPEN_TRACKS;
}

export interface LanguageShelfData {
    language: string;
    label: string;
    tracks: TrackItem[];
    error?: string;
}

const HOME_SAAVN_TRACK_LIMIT = 24;

export async function getJioSaavnShelves(
    languages: string[],
    signal?: AbortSignal
): Promise<LanguageShelfData[]> {
    const langs = normalizeMusicLanguages(languages);
    if (langs.length === 0) return [];

    const requestSignal = signal ?? AbortSignal.timeout(20000);
    const results: LanguageShelfData[] = new Array(langs.length);
    const CONCURRENCY = 2; // Bounded concurrency so we do not overload the service

    let nextIndex = 0;
    async function worker() {
        while (nextIndex < langs.length) {
            if (requestSignal.aborted) return;
            const i = nextIndex++;
            const lang = langs[i];
            const opt = LOCALE_OPTIONS.find(o => o.value === lang);
            const label = opt ? opt.label : lang;
            try {
                const query = `${lang} top songs`;
                const tracks = await searchJioSaavn(query, requestSignal, HOME_SAAVN_TRACK_LIMIT);
                const ranked = rankSongsByLanguage(tracks, lang, query);
                results[i] = { language: lang, label, tracks: ranked };
            } catch (err) {
                results[i] = {
                    language: lang,
                    label,
                    tracks: [],
                    error: err instanceof Error ? err.message : 'Failed to load',
                };
            }
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, langs.length) }, () => worker());
    await Promise.all(workers);
    return results.filter(Boolean);
}

export async function getJioSaavnGlobalTop(
    language?: string,
    signal?: AbortSignal
): Promise<TrackItem[]> {
    const requestSignal = signal ?? AbortSignal.timeout(15000);
    const lang = language ? normalizeMusicLanguage(language) : '';
    const query = lang ? `${lang} top songs` : 'trending songs';
    const results = await searchJioSaavn(query, requestSignal, HOME_SAAVN_TRACK_LIMIT);
    return lang ? rankSongsByLanguage(results, lang, query) : results;
}

export async function getJioSaavnLanguagePicks(
    languageOrLanguages?: string | string[],
    signal?: AbortSignal
): Promise<TrackItem[]> {
    const langs = normalizeMusicLanguages(languageOrLanguages);
    const requestSignal = signal ?? AbortSignal.timeout(15000);

    // If no language preference, query general trending songs
    if (langs.length === 0) {
        const query = 'trending songs';
        const results = await searchJioSaavn(query, requestSignal);
        return rankSongsByLanguage(results, '', query);
    }

    // Single language preference
    if (langs.length === 1) {
        const query = `${langs[0]} top songs`;
        const results = await searchJioSaavn(query, requestSignal);
        return rankSongsByLanguage(results, langs, query);
    }

    // Multiple languages: fan out to at most 3 selected languages concurrently to prevent unbounded fanout
    const targetLangs = langs.slice(0, 3);
    const settled = await Promise.allSettled(
        targetLangs.map(l => searchJioSaavn(`${l} top songs`, requestSignal))
    );

    const batches: TrackItem[][] = [];
    for (const res of settled) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            batches.push(res.value);
        }
    }

    if (batches.length === 0) {
        // If all language lookups failed, throw the first rejection if present
        const rejected = settled.find(s => s.status === 'rejected') as PromiseRejectedResult | undefined;
        if (rejected) throw rejected.reason;
        return [];
    }

    // Interleave tracks so each language is represented equally
    const seen = new Set<string>();
    const merged: TrackItem[] = [];
    const maxLen = Math.max(...batches.map(b => b.length));
    for (let i = 0; i < maxLen; i++) {
        for (const batch of batches) {
            const track = batch[i];
            if (track && !seen.has(track.id)) {
                seen.add(track.id);
                merged.push(track);
            }
        }
    }

    return rankSongsByLanguage(merged, langs, '');
}

export interface ResolverDiagnostics {
    platform: string;
    catalogName: string;
    catalogSourceUrl: string;
    listeningLanguage: string;
    streamPrimary: string;
    liveResolverStatus: string;
    liveResolverVersion?: number;
    invidiousProxy: string;
    audioEngine: string;
}

export function getDiagnostics(provider: WebCatalog): ResolverDiagnostics {
    const native = isNative();
    const prefs = useListeningPreferences.getState();
    const langs = prefs.languages.length > 0
        ? prefs.languages
        : prefs.language ? [prefs.language] : [];

    let langLabel = 'No preference';
    if (langs.length > 0) {
        const labels = langs.map(code => {
            const opt = MUSIC_LANGUAGES.find(l => l.value === code);
            return opt?.value ? opt.label : code;
        });
        langLabel = labels.join(', ');
    }

    const invidiousProxy = usePlayerStore.getState().proxy
        || import.meta.env.VITE_INVIDIOUS_URL?.trim()
        || 'https://invidious.fdn.fr';

    const baseUrl = API_BASE_URL.replace(/\/+$/, '') || '(relative /api)';
    const saavnOrigin = (import.meta.env.VITE_JIOSAAVN_API_URL?.trim() || 'https://m14u-jiosaavn.onrender.com').replace(/\/+$/, '');

    // Live resolver check
    const manifestUrl = import.meta.env.VITE_RESOLVER_MANIFEST_URL;
    const publicKey = import.meta.env.VITE_RESOLVER_PUBLIC_KEY;
    let liveResolverStatus = 'Not configured';
    let liveResolverVersion: number | undefined;

    if (manifestUrl && publicKey) {
        liveResolverStatus = 'Configured';
        try {
            const cached = localStorage.getItem('m14u.live-resolver.v1');
            if (cached) {
                const parsed = JSON.parse(cached) as { version?: number };
                if (parsed?.version) {
                    liveResolverVersion = parsed.version;
                    liveResolverStatus = `Active (v${parsed.version})`;
                }
            } else {
                liveResolverStatus = 'Ready (no cached bundle)';
            }
        } catch {
            liveResolverStatus = 'Configured (cache unavailable)';
        }
    }

    if (native) {
        return {
            platform: 'Android (Capacitor Native)',
            catalogName: 'YouTube Music (Direct worker catalog)',
            catalogSourceUrl: `${baseUrl}/api/*?catalog=youtube`,
            listeningLanguage: langLabel,
            streamPrimary: 'Bundled NewPipe Extractor (StreamExtractor plugin)',
            liveResolverStatus,
            liveResolverVersion,
            invidiousProxy,
            audioEngine: 'Media3 / ExoPlayer (NativePlayback)',
        };
    }

    if (provider === 'jiosaavn') {
        return {
            platform: 'Web Browser',
            catalogName: 'JioSaavn',
            catalogSourceUrl: `${saavnOrigin}/api/search/songs`,
            listeningLanguage: langLabel,
            streamPrimary: 'Render relay /api/audio/:id (AAC byte-ranges)',
            liveResolverStatus: 'Web uses direct audio endpoints',
            invidiousProxy,
            audioEngine: 'HTML5 Audio (HTMLAudioElement)',
        };
    }

    return {
        platform: 'Web Browser',
        catalogName: 'Open Audio (Audius, Jamendo, Free To Use)',
        catalogSourceUrl: `${baseUrl}/api/* (Open Federated)`,
        listeningLanguage: langLabel,
        streamPrimary: 'Worker /api/stream (Direct audio format)',
        liveResolverStatus: 'Web uses direct audio endpoints',
        invidiousProxy,
        audioEngine: 'HTML5 Audio (HTMLAudioElement)',
    };
}
