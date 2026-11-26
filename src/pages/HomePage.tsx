import { useState, useEffect, useRef } from 'react';
import {
    Search,
    Play,
    RefreshCw,
    Sparkles,
    Disc3,
    Languages,
    Settings2,
    ShieldCheck,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    Globe,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { MobileAppPromo } from '@/components/MobileAppPromo';
import { Link } from 'react-router-dom';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { SongCard } from '@/components/song/SongCard';
import { matchesCatalog, useCatalogStore } from '@/stores/catalogStore';
import { playCatalogSelection } from '@/services/catalogPlayback';
import { useListeningPreferences, MUSIC_LANGUAGES } from '@/stores/listeningPreferences';
import { isNative } from '@/lib/utils/platform';
import { LOCALE_OPTIONS } from '@/utils/constants';
import {
    getAndroidRecommendations,
    getOpenAudioFeatured,
    getJioSaavnShelves,
    getJioSaavnGlobalTop,
    FALLBACK_OPEN_TRACKS,
    type LanguageShelfData,
} from '@/services/homeDiscovery';
import type { TrackItem } from '@/types/music';

const ALL_GLOBAL_TOP_OPTIONS = [
    { value: '', label: 'All languages' },
    ...LOCALE_OPTIONS,
];

export function HomePage() {
    const history = usePlayerStore(s => s.listeningHistory);
    const removeFromHistory = usePlayerStore(s => s.removeFromHistory);
    const setQueue = usePlayerStore(s => s.setQueue);
    const provider = useCatalogStore(s => s.provider);
    const openSettings = useCatalogStore(s => s.openSettings);
    const chooseCatalog = useCatalogStore(s => s.choose);

    const { languages } = useListeningPreferences();
    const globalTopLanguage = useUIStore(s => s.globalTopLanguage);
    const setGlobalTopLanguage = useUIStore(s => s.setGlobalTopLanguage);
    const native = isNative();

    // Recently played filtered by catalog
    const recent = history.filter(({ song }) => matchesCatalog(provider, song.id));
    const recentShelfRef = useRef<HTMLDivElement>(null);
    const [recentColumns, setRecentColumns] = useState(0);
    const recentCount = recent.length;
    useEffect(() => {
        const shelf = recentShelfRef.current;
        const card = shelf?.firstElementChild;
        if (!shelf || !card) return;
        const measure = () => {
            const gap = parseFloat(getComputedStyle(shelf).columnGap) || 0;
            const width = card.getBoundingClientRect().width;
            if (width > 0) setRecentColumns(Math.max(1, Math.floor((shelf.clientWidth + gap) / (width + gap))));
        };
        const observer = new ResizeObserver(measure);
        observer.observe(shelf);
        observer.observe(card);
        measure();
        return () => observer.disconnect();
    }, [recentCount, provider]);
    const recentRows = recentColumns > 0 && recentCount >= recentColumns * 2 ? 2 : 1;
    const seedTrack = recent[0]?.song || history[0]?.song || null;

    // Discovery states
    const [androidData, setAndroidData] = useState<{ seed: TrackItem | null; tracks: TrackItem[] }>({
        seed: null,
        tracks: [],
    });
    const [openAudioTracks, setOpenAudioTracks] = useState<TrackItem[]>(FALLBACK_OPEN_TRACKS);

    // JioSaavn language shelves (one shelf per selected language)
    const [jioSaavnShelves, setJioSaavnShelves] = useState<LanguageShelfData[]>([]);
    const [isShelvesLoading, setIsShelvesLoading] = useState(false);

    // JioSaavn Global Top section (local language filter)
    const [globalTopTracks, setGlobalTopTracks] = useState<TrackItem[]>([]);
    const [isGlobalTopLoading, setIsGlobalTopLoading] = useState(false);
    const [globalTopError, setGlobalTopError] = useState<string | null>(null);

    const [isGeneralLoading, setIsGeneralLoading] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    const languagesKey = languages.join(',');
    const activeLanguagesLabel = languages.length > 0
        ? languages
              .map(code => MUSIC_LANGUAGES.find(l => l.value === code)?.label || code)
              .join(', ')
        : '';

    const globalTopLanguageOption = ALL_GLOBAL_TOP_OPTIONS.find(o => o.value === globalTopLanguage);
    const globalTopLanguageLabel = globalTopLanguageOption?.value ? globalTopLanguageOption.label : '';

    // Load Android or Open Audio discovery
    useEffect(() => {
        if (provider === 'jiosaavn' && !native) return;
        let isMounted = true;
        const controller = new AbortController();

        async function loadContent() {
            try {
                if (native) {
                    const result = await getAndroidRecommendations(seedTrack, languages, controller.signal);
                    if (isMounted) {
                        setAndroidData(result);
                        setIsGeneralLoading(false);
                    }
                } else if (provider === 'open-audio') {
                    const tracks = await getOpenAudioFeatured(controller.signal);
                    if (isMounted) {
                        setOpenAudioTracks(tracks);
                        setIsGeneralLoading(false);
                    }
                }
            } catch (err) {
                if (isMounted && !controller.signal.aborted) {
                    console.warn('[HomePage] Discovery failed:', err);
                    setIsGeneralLoading(false);
                }
            }
        }

        void loadContent();

        return () => {
            isMounted = false;
            controller.abort();
        };
    }, [native, provider, languages, languagesKey, seedTrack, reloadKey]);

    // Load JioSaavn separate language shelves (bounded concurrency, no omission)
    useEffect(() => {
        if (native || provider !== 'jiosaavn') return;

        let isMounted = true;
        const controller = new AbortController();

        async function loadShelves() {
            if (languages.length === 0) {
                if (isMounted) {
                    setJioSaavnShelves([]);
                    setIsShelvesLoading(false);
                }
                return;
            }
            setIsShelvesLoading(true);
            try {
                const results = await getJioSaavnShelves(languages, controller.signal);
                if (isMounted) {
                    setJioSaavnShelves(results);
                    setIsShelvesLoading(false);
                }
            } catch (err) {
                if (isMounted && !controller.signal.aborted) {
                    console.warn('[HomePage] Shelves failed:', err);
                    setIsShelvesLoading(false);
                }
            }
        }

        void loadShelves();

        return () => {
            isMounted = false;
            controller.abort();
        };
    }, [native, provider, languages, languagesKey, reloadKey]);

    // Load JioSaavn Global Top section with local filter
    useEffect(() => {
        if (native || provider !== 'jiosaavn') return;
        let isMounted = true;
        const controller = new AbortController();

        async function loadGlobalTop() {
            setIsGlobalTopLoading(true);
            setGlobalTopError(null);
            try {
                const tracks = await getJioSaavnGlobalTop(globalTopLanguage, controller.signal);
                if (isMounted) {
                    setGlobalTopTracks(tracks);
                    setIsGlobalTopLoading(false);
                    setGlobalTopError(null);
                }
            } catch (err) {
                if (isMounted && !controller.signal.aborted) {
                    console.warn('[HomePage] Global Top failed:', err);
                    setGlobalTopError(err instanceof Error ? err.message : 'Failed to load Global Top');
                    setIsGlobalTopLoading(false);
                }
            }
        }

        void loadGlobalTop();

        return () => {
            isMounted = false;
            controller.abort();
        };
    }, [native, provider, globalTopLanguage, reloadKey]);

    const handlePlayAll = (tracks: TrackItem[]) => {
        if (tracks.length > 0) {
            void setQueue(tracks, 0);
        }
    };

    return (
        <div className="w-full min-h-full px-4 sm:px-6 lg:px-8 py-6 md:py-8 max-w-7xl mx-auto space-y-8 md:space-y-10 [&_.grid]:grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] md:[&_.grid]:grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))]">
            {/* ─── Header & Status ─── */}
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-white/[0.06]">
                <div className="flex items-center justify-between w-full md:w-auto">
                    <div className="flex items-center gap-3">
                        <BrandLogo className="size-8 md:hidden" alt="M14U" />
                        <div>
                            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold font-heading tracking-tight text-foreground">
                                Home
                            </h1>
                            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                                {native
                                    ? 'Android YouTube recommendations with native audio'
                                    : provider === 'open-audio'
                                    ? 'Freely licensed open catalog from independent artists'
                                    : 'Personalized language picks from JioSaavn'}
                            </p>
                        </div>
                    </div>

                    {/* Move Settings from bottom nav to top right on Home for mobile */}
                    <button
                        type="button"
                        onClick={openSettings}
                        aria-label="Settings"
                        title="Open Settings"
                        className="md:hidden inline-flex items-center justify-center size-9 rounded-xl bg-surface border border-border text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                    >
                        <Settings2 className="size-5" />
                    </button>
                </div>

                {/* On desktop, keep the annotated badges and actions */}
                <div className="hidden md:flex items-center gap-2 flex-wrap">
                    {/* Catalog badge */}
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-surface border border-border text-foreground">
                        <Disc3 className="size-3.5 text-primary" />
                        {native ? 'YouTube' : provider === 'open-audio' ? 'Open Audio' : 'JioSaavn'}
                    </span>

                    {/* Language badge */}
                    {activeLanguagesLabel && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
                            <Languages className="size-3.5" />
                            {activeLanguagesLabel}
                        </span>
                    )}
                </div>
            </header>

            {/* ─── Recently Played Section ─── */}
            {recent.length > 0 && (
                <section aria-labelledby="recently-played-heading" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 id="recently-played-heading" className="text-lg sm:text-xl font-bold font-heading text-foreground">
                                Recently played
                            </h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Jump back into what you were listening to
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => handlePlayAll(recent.map(r => r.song))}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-xs font-medium text-foreground transition-colors border border-border"
                        >
                            <Play className="size-3 fill-current" />
                            Play all
                        </button>
                    </div>

                    <div
                        ref={recentShelfRef}
                        role="region"
                        aria-labelledby="recently-played-heading"
                        tabIndex={recentCount > recentColumns * recentRows ? 0 : undefined}
                        className="grid-flow-col auto-cols-[140px] sm:auto-cols-[160px] md:auto-cols-[175px] items-start gap-3 sm:gap-4 overflow-x-auto overscroll-x-contain rounded-xl pb-2 pt-1 scrollbar-thin focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        style={{ display: 'grid', gridTemplateColumns: 'none', gridTemplateRows: `repeat(${recentRows}, auto)` }}
                    >
                        {recent.map(({ song }, index) => (
                            <div key={song.id} className="min-w-0">
                                <SongCard
                                    song={song}
                                    index={index}
                                    highQualityArtwork
                                    onPlay={() => void playCatalogSelection(recent.map(r => r.song), index)}
                                    onRemoveFromHistory={() => removeFromHistory(song.id)}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ─── Discovery Sections ─── */}

            {/* 1. ANDROID: YouTube recommendations seeded by recent track */}
            {native && (
                <section aria-labelledby="android-recommendations-heading" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 id="android-recommendations-heading" className="text-lg sm:text-xl font-bold font-heading text-foreground flex items-center gap-2">
                                <Sparkles className="size-4 text-primary" />
                                {androidData.seed
                                    ? 'Recommended for you'
                                    : 'Trending on YouTube'}
                            </h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {androidData.seed
                                    ? `Seeded by “${androidData.seed.title}” by ${androidData.seed.author}`
                                    : activeLanguagesLabel
                                    ? `Top recommendations in ${activeLanguagesLabel}`
                                    : 'Popular music recommendations on YouTube'}
                            </p>
                        </div>

                        {androidData.tracks.length > 0 && (
                            <button
                                type="button"
                                onClick={() => handlePlayAll(androidData.tracks)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground transition-colors shadow-sm"
                            >
                                <Play className="size-3 fill-current" />
                                Play all
                            </button>
                        )}
                    </div>

                    {isGeneralLoading ? (
                        <DiscoverySkeleton count={6} />
                    ) : androidData.tracks.length > 0 ? (
                        <div className="grid gap-3 sm:gap-4">
                            {androidData.tracks.map((song, index) => (
                                <SongCard
                                    key={song.id}
                                    song={song}
                                    index={index}
                                    highQualityArtwork
                                    onPlay={() => void setQueue(androidData.tracks, index)}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-border bg-surface/50 p-6 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Could not load recommendations right now. Check your internet connection or search for a track.
                            </p>
                            <button
                                type="button"
                                onClick={() => setReloadKey(k => k + 1)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs font-medium text-foreground transition-colors"
                            >
                                <RefreshCw className="size-3.5" />
                                Try again
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* 2. WEB: Open Audio featured tracks and license */}
            {!native && provider === 'open-audio' && (
                <section aria-labelledby="open-audio-heading" className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <h2 id="open-audio-heading" className="text-lg sm:text-xl font-bold font-heading text-foreground flex items-center gap-2">
                                <ShieldCheck className="size-5 text-emerald-400" />
                                Featured in Open Audio
                            </h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Freely licensed music from independent creators, Jamendo (Openverse), and Free To Use
                            </p>
                        </div>

                        {openAudioTracks.length > 0 && (
                            <button
                                type="button"
                                onClick={() => handlePlayAll(openAudioTracks)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground transition-colors self-start sm:self-auto shadow-sm"
                            >
                                <Play className="size-3 fill-current" />
                                Play featured
                            </button>
                        )}
                    </div>

                    {/* License Callout Banner */}
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-start gap-3">
                        <ShieldCheck className="size-5 text-emerald-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-muted-foreground leading-relaxed">
                            <span className="font-semibold text-foreground">Verified Open Licenses:</span> Tracks in this section are distributed under Creative Commons or open terms with verified creator attribution. Stream, discover, and support independent music.
                        </div>
                    </div>

                    {isGeneralLoading ? (
                        <DiscoverySkeleton count={6} />
                    ) : (
                        <div className="grid gap-3 sm:gap-4">
                            {openAudioTracks.map((song, index) => (
                                <SongCard
                                    key={song.id}
                                    song={song}
                                    index={index}
                                    highQualityArtwork
                                    onPlay={() => void playCatalogSelection(openAudioTracks, index)}
                                />
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* 3. WEB: JioSaavn Shelves for EACH selected language + Global Top section */}
            {!native && provider === 'jiosaavn' && (
                <div className="space-y-8 md:space-y-10">
                    {/* A. Separate two-row horizontally scrollable shelf for EACH selected language */}
                    {isShelvesLoading && languages.length > 0 ? (
                        <div className="space-y-6">
                            {languages.map((lang) => {
                                const opt = ALL_GLOBAL_TOP_OPTIONS.find(o => o.value === lang);
                                const label = opt ? opt.label : lang;
                                return (
                                    <TwoRowArtworkShelf
                                        key={lang}
                                        label={label}
                                        tracks={[]}
                                        isLoading
                                        onPlayAll={handlePlayAll}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        jioSaavnShelves.map((shelf) => (
                            <TwoRowArtworkShelf
                                key={shelf.language}
                                label={shelf.label}
                                tracks={shelf.tracks}
                                error={shelf.error}
                                onRetry={() => setReloadKey(k => k + 1)}
                                onPlayAll={handlePlayAll}
                            />
                        ))
                    )}

                    {/* B. Final Global Top section with local language selector */}
                    <section aria-labelledby="global-top-heading" className="space-y-4 border-t border-white/[0.06] pt-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <h2 id="global-top-heading" className="text-lg sm:text-xl font-bold font-heading text-foreground flex items-center gap-2">
                                    <Globe className="size-5 text-primary" />
                                    {globalTopLanguageLabel ? `${globalTopLanguageLabel} Top Picks` : 'Global Top Picks'}
                                </h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {globalTopLanguageLabel
                                        ? `Search picks for popular ${globalTopLanguageLabel} tracks on JioSaavn`
                                        : 'Search picks for trending and popular music across JioSaavn'}
                                </p>
                            </div>

                            {globalTopTracks.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => handlePlayAll(globalTopTracks)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground transition-colors self-start sm:self-auto shadow-sm"
                                >
                                    <Play className="size-3 fill-current" />
                                    Play all
                                </button>
                            )}
                        </div>

                        {/* Local language selector for Global Top section */}
                        <div
                            className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
                            role="tablist"
                            aria-label="Global Top language filter"
                        >
                            {ALL_GLOBAL_TOP_OPTIONS.map((item) => {
                                const isSelected = globalTopLanguage === item.value;
                                return (
                                    <button
                                        key={item.value}
                                        type="button"
                                        role="tab"
                                        aria-selected={isSelected}
                                        onClick={() => setGlobalTopLanguage(item.value)}
                                        className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                                            isSelected
                                                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                                : 'bg-surface text-muted-foreground border-border hover:text-foreground hover:bg-surface-hover'
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>

                        {isGlobalTopLoading ? (
                            <div className="space-y-3">
                                <p className="text-xs text-muted-foreground animate-pulse">
                                    Loading Global Top tracks…
                                </p>
                                <DiscoverySkeleton count={6} />
                            </div>
                        ) : globalTopError ? (
                            <div className="rounded-2xl border border-border bg-surface/50 p-6 text-center space-y-3">
                                <AlertCircle className="size-6 text-amber-400 mx-auto" />
                                <h3 className="text-sm font-semibold text-foreground">
                                    JioSaavn service is warming up
                                </h3>
                                <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                                    The Render free service may be spinning up from idle (30–60 seconds). You can retry or switch to Open Audio for immediate playback.
                                </p>
                                <div className="flex items-center justify-center gap-3 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setReloadKey(k => k + 1)}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                                    >
                                        <RefreshCw className="size-3.5" />
                                        Retry
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => chooseCatalog('open-audio')}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs font-medium text-foreground transition-colors"
                                    >
                                        Switch to Open Audio
                                    </button>
                                </div>
                                <MobileAppPromo
                                    className="mt-4 max-w-lg mx-auto text-left"
                                    title="Avoid warm-up and catalog errors on Mobile"
                                    description="If you use the M14U mobile app, you won’t get any of these service errors — the mobile app uses YouTube Music directly."
                                />
                            </div>
                        ) : globalTopTracks.length > 0 ? (
                            <div className="grid gap-3 sm:gap-4">
                                {globalTopTracks.map((song, index) => (
                                    <SongCard
                                        key={song.id}
                                        song={song}
                                        index={index}
                                        highQualityArtwork
                                        onPlay={() => void playCatalogSelection(globalTopTracks, index)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-border bg-surface/50 p-6 text-center text-sm text-muted-foreground">
                                No tracks found for this language filter.
                            </div>
                        )}
                    </section>
                </div>
            )}

            {/* ─── Empty state helper when history is clean ─── */}
            {recent.length === 0 && !isGeneralLoading && (
                <section className="rounded-2xl border border-border/60 bg-gradient-to-r from-surface to-surface/40 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                    <div className="space-y-1 max-w-lg">
                        <h3 className="text-base sm:text-lg font-bold font-heading text-foreground">
                            Explore more music
                        </h3>
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                            Search for artists, titles, or genres. Songs you listen to will appear in your recently played list.
                        </p>
                    </div>
                    <Link
                        to="/search"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-sm font-semibold text-primary-foreground transition-colors shadow-sm"
                    >
                        <Search className="size-4" />
                        Search music
                    </Link>
                </section>
            )}
        </div>
    );
}

/** Two-row horizontally scrollable artwork shelf for a specific language */
function TwoRowArtworkShelf({
    label,
    tracks,
    isLoading,
    error,
    onRetry,
    onPlayAll,
}: {
    label: string;
    tracks: TrackItem[];
    isLoading?: boolean;
    error?: string;
    onRetry?: () => void;
    onPlayAll: (tracks: TrackItem[]) => void;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const amount = direction === 'left' ? -340 : 340;
        scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    };

    // Group items into pairs of two for the 2-row layout
    const columns: TrackItem[][] = [];
    for (let i = 0; i < tracks.length; i += 2) {
        columns.push(tracks.slice(i, i + 2));
    }

    return (
        <section aria-label={`${label} picks`} className="space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg sm:text-xl font-bold font-heading text-foreground flex items-center gap-2">
                        <Languages className="size-5 text-primary" />
                        {label} picks
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Search picks for {label} music on JioSaavn
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Desktop scroll navigation buttons */}
                    <div className="hidden sm:flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => scroll('left')}
                            aria-label={`Scroll ${label} shelf left`}
                            className="size-7 rounded-lg bg-surface border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                        >
                            <ChevronLeft className="size-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => scroll('right')}
                            aria-label={`Scroll ${label} shelf right`}
                            className="size-7 rounded-lg bg-surface border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
                        >
                            <ChevronRight className="size-4" />
                        </button>
                    </div>

                    {tracks.length > 0 && (
                        <button
                            type="button"
                            onClick={() => onPlayAll(tracks)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground transition-colors shadow-sm"
                        >
                            <Play className="size-3 fill-current" />
                            Play all
                        </button>
                    )}
                </div>
            </div>

            {isLoading ? (
                <div className="flex overflow-x-auto gap-3 sm:gap-4 pb-2 pt-1 scrollbar-none">
                    {Array.from({ length: 4 }).map((_, col) => (
                        <div key={col} className="flex flex-col gap-3 w-[140px] sm:w-[160px] md:w-[175px] shrink-0">
                            <div className="aspect-square rounded-xl bg-surface/40 animate-pulse" />
                            <div className="aspect-square rounded-xl bg-surface/40 animate-pulse" />
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="rounded-xl border border-border bg-surface/40 p-4 text-xs text-muted-foreground space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <span>Could not load {label} picks.</span>
                        {onRetry && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="px-3 py-1 rounded-lg bg-surface hover:bg-surface-hover border border-border text-foreground font-medium shrink-0"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                    <MobileAppPromo
                        variant="inline"
                        description="If you were using the M14U mobile app, you wouldn’t get catalog errors like this because it uses YouTube Music."
                    />
                </div>
            ) : tracks.length > 0 ? (
                <div
                    ref={scrollRef}
                    tabIndex={0}
                    role="region"
                    aria-label={`${label} music shelf`}
                    className="flex overflow-x-auto gap-3 sm:gap-4 pb-2 pt-1 scrollbar-thin touch-pan-x overscroll-x-contain focus:outline-none focus:ring-1 focus:ring-primary/40 rounded-xl"
                >
                    {columns.map((column, colIdx) => (
                        <div
                            key={colIdx}
                            className="flex flex-col gap-3 sm:gap-4 w-[140px] sm:w-[160px] md:w-[175px] shrink-0"
                        >
                            {column.map((song, rowIdx) => (
                                <SongCard
                                    key={song.id}
                                    song={song}
                                    index={colIdx * 2 + rowIdx}
                                    highQualityArtwork
                                    onPlay={() => void onPlayAll(tracks)}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-border bg-surface/30 p-4 text-xs text-muted-foreground">
                    No tracks found for {label}.
                </div>
            )}
        </section>
    );
}

/** Fluid skeleton placeholder while discovery content loads */
function DiscoverySkeleton({ count = 6 }: { count?: number }) {
    return (
        <div className="grid gap-3 sm:gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="flex flex-col p-2 rounded-xl bg-surface/30 animate-pulse space-y-2.5">
                    <div className="aspect-square w-full rounded-lg bg-white/[0.06]" />
                    <div className="h-3.5 w-4/5 rounded bg-white/[0.06]" />
                    <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
                </div>
            ))}
        </div>
    );
}
