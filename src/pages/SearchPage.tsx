/** SearchPage — Debounced music search and playback from results. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, Clock, Loader2, MoreHorizontal } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { useSearchStore } from '@/lib/stores/search';
import { SongRow } from '@/components/song/SongRow';
import { SongCard } from '@/components/song/SongCard';
import { API_BASE_URL, DEBOUNCE } from '@/utils/constants';
import { isNative } from '@/lib/utils/platform';
import { useCatalogStore } from '@/stores/catalogStore';
import type { TrackItem } from '@/types/music';

const SUGGESTIONS = ['Lofi', 'Jazz', 'Ambient', 'Piano'];

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function SearchPage() {
    const [query, setQuery] = useState('');
    const [visibleRecentCount, setVisibleRecentCount] = useState(3);
    const [isComposing, setIsComposing] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [openDiscovery, setOpenDiscovery] = useState<{ openCatalog: boolean; tracks: TrackItem[] }>({ openCatalog: false, tracks: [] });
    const provider = useCatalogStore(s => s.provider);
    const discovery = provider === 'open-audio' ? openDiscovery : { openCatalog: false, tracks: [] };
    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsHeadingRef = useRef<HTMLHeadingElement>(null);
    const term = query.trim();

    const search = useSearchStore(s => s.search);
    const searchedTerm = useSearchStore(s => s.query);
    const results = useSearchStore(s => s.results);
    const songDiscovery = useSearchStore(s => s.discovery);
    const loading = useSearchStore(s => s.isLoading);
    const error = useSearchStore(s => s.error);
    const clearSearch = useSearchStore(s => s.clearSearch);
    const setQueue = usePlayerStore(s => s.setQueue);
    const recentSearches = useUIStore(s => s.recentSearches);
    const addRecentSearch = useUIStore(s => s.addRecentSearch);
    const removeRecentSearch = useUIStore(s => s.removeRecentSearch);
    const clearRecentSearches = useUIStore(s => s.clearRecentSearches);

    const runSearch = useCallback((value: string, retry = false) => {
        const current = useSearchStore.getState();
        if (!value || (current.query === value && !(retry && current.error))) return;
        addRecentSearch(value);
        void search(value);
    }, [addRecentSearch, search]);

    useEffect(() => {
        if (!term || isComposing) return;
        const timer = window.setTimeout(() => runSearch(term), DEBOUNCE.SEARCH);
        return () => window.clearTimeout(timer);
    }, [term, isComposing, runSearch, provider]);

    useEffect(() => () => clearSearch(), [clearSearch]);

    useEffect(() => {
        if (isNative() || provider !== 'open-audio') return;
        const request = new AbortController();
        void fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/search-discovery`, { signal: request.signal })
            .then(async response => {
                if (!response.ok) return;
                const data = await response.json();
                if (!request.signal.aborted && typeof data?.openCatalog === 'boolean' && Array.isArray(data.tracks)) setOpenDiscovery(data);
            })
            .catch(() => { /* Search remains available without discovery. */ });
        return () => request.abort();
    }, [provider]);

    const updateQuery = (value: string) => {
        if (value.trim() !== term) clearSearch();
        setQuery(value);
    };

    const clearQuery = () => {
        updateQuery('');
        inputRef.current?.focus();
    };

    const selectSuggestion = (value: string) => {
        updateQuery(value);
        runSearch(value, true);
        inputRef.current?.focus();
    };

    const current = Boolean(term && searchedTerm === term);
    const songs = current ? results.filter((r): r is TrackItem => r.type === 'song' || r.type === 'video') : [];
    const pending = Boolean(term && (!current || loading));
    const failed = current && Boolean(error);
    const empty = current && !loading && !failed && songs.length === 0;
    const resultsLabel = current && songDiscovery ? 'JioSaavn results' : `${songs.length} ${songs.length === 1 ? 'result' : 'results'}`;
    const announcement = pending ? 'Searching…'
        : failed ? 'Search couldn’t load.'
        : empty ? `No songs found for “${term}”.`
        : songs.length ? `${resultsLabel} for “${term}”.`
        : '';

    const handlePlayFromResults = (index: number) => {
        void setQueue(songs, index);
    };

    return (
        <div className="pb-8">
            <header className="sticky top-0 z-10 border-b border-border/50 bg-background/95 backdrop-blur-md">
                <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 md:px-8 md:py-5">
                    <h1 className="mb-2 font-heading text-xl font-bold tracking-tight md:mb-3 md:text-2xl">Search</h1>
                    <form
                        role="search"
                        aria-label="Music"
                        className="relative max-w-2xl"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!isComposing) runSearch(term, true);
                        }}
                    >
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                        <input
                            ref={inputRef}
                            type="search"
                            aria-label="Search music"
                            enterKeyHint="search"
                            autoComplete="off"
                            value={query}
                            onChange={(event) => updateQuery(event.target.value)}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape' && query && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    clearQuery();
                                }
                            }}
                            placeholder={discovery.openCatalog ? 'Search by title, artist, or genre' : 'Search for tracks'}
                            className={`h-12 w-full rounded-xl border border-border bg-surface pl-11 pr-12 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
                        />
                        {query && (
                            <button
                                type="button"
                                aria-label="Clear search"
                                onClick={clearQuery}
                                className={`absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-foreground ${focusRing}`}
                            >
                                <X aria-hidden="true" className="h-4 w-4" />
                            </button>
                        )}
                    </form>
                    {discovery.openCatalog && (
                        <p className="mt-2 text-xs text-muted-foreground">This catalog focuses on open and independent music. Try a genre like jazz or lo-fi.</p>
                    )}
                </div>
            </header>

            <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 md:px-8 md:pt-7">
                <p role="status" className="sr-only">{announcement}</p>
                {!term && (
                    <div className="max-w-2xl space-y-7">
                        {recentSearches.length > 0 && (
                            <section aria-labelledby="recent-searches-heading">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4">
                                    <h2 id="recent-searches-heading" className="font-heading text-base font-bold">Recent searches</h2>
                                    <button
                                        type="button"
                                        aria-label="Clear all recent searches"
                                        onClick={() => {
                                            suggestionsHeadingRef.current?.focus();
                                            clearRecentSearches();
                                            setVisibleRecentCount(3);
                                        }}
                                        className={`min-h-10 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground ${focusRing}`}
                                    >
                                        Clear all
                                    </button>
                                </div>
                                <ul className="flex flex-wrap gap-2">
                                    {recentSearches.slice(0, visibleRecentCount).map((entry) => (
                                        <li key={entry} className="flex min-w-0 max-w-full items-stretch rounded-full bg-surface">
                                            <button
                                                type="button"
                                                onClick={() => selectSuggestion(entry)}
                                                className={`flex min-h-11 min-w-0 items-center gap-2 rounded-l-full py-2 pl-3 pr-1 text-left text-sm hover:bg-surface-hover ${focusRing}`}
                                            >
                                                <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="break-words [overflow-wrap:anywhere]">{entry}</span>
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Remove “${entry}” from recent searches`}
                                                onClick={(event) => {
                                                    const item = event.currentTarget.closest('li');
                                                    const next = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector<HTMLButtonElement>('button:last-child');
                                                    (next ?? suggestionsHeadingRef.current)?.focus();
                                                    removeRecentSearch(entry);
                                                }}
                                                className={`grid w-11 shrink-0 place-items-center rounded-r-full text-muted-foreground hover:bg-surface-hover hover:text-foreground ${focusRing}`}
                                            >
                                                <X aria-hidden="true" className="h-3.5 w-3.5" />
                                            </button>
                                        </li>
                                    ))}
                                    {recentSearches.length > visibleRecentCount && (
                                        <li>
                                            <button
                                                type="button"
                                                aria-label="Show more recent searches"
                                                title="Show more recent searches"
                                                onClick={(event) => {
                                                    const previous = event.currentTarget.closest('li')?.previousElementSibling;
                                                    previous?.querySelector('button')?.focus();
                                                    setVisibleRecentCount(count => count + 3);
                                                }}
                                                className={`grid size-11 place-items-center rounded-full bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground ${focusRing}`}
                                            >
                                                <MoreHorizontal aria-hidden="true" className="size-5" />
                                            </button>
                                        </li>
                                    )}
                                </ul>
                            </section>
                        )}
                        <section aria-labelledby="suggested-searches-heading">
                            <h2 id="suggested-searches-heading" ref={suggestionsHeadingRef} tabIndex={-1} className="mb-3 w-fit rounded-sm font-heading text-base font-bold focus:outline-primary">
                                {discovery.openCatalog ? 'Try these searches' : 'Try a search'}
                            </h2>
                            <ul className="flex flex-wrap gap-2">
                                {(discovery.openCatalog ? SUGGESTIONS : []).map((suggestion) => (
                                    <li key={suggestion}>
                                        <button type="button" onClick={() => selectSuggestion(suggestion)} className={`min-h-11 rounded-full bg-surface px-4 text-sm hover:bg-surface-hover hover:text-primary ${focusRing}`}>
                                            {suggestion}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            {!discovery.openCatalog && <p className="text-sm text-muted-foreground">Start with a song title or an artist’s name.</p>}
                        </section>
                    </div>
                )}

                {pending && (
                    <div aria-hidden="true" className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 text-primary motion-safe:animate-spin" />
                        Searching…
                    </div>
                )}

                {(failed || (empty && !songDiscovery)) && (
                    <div className="max-w-2xl rounded-xl border border-border bg-surface px-4 py-5 sm:px-5">
                        <h2 className="font-heading font-bold [overflow-wrap:anywhere]">{announcement}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {failed ? 'Check your connection and try again.' : discovery.openCatalog
                                ? 'That recording may not be in our open catalog. Try the artist’s name, a shorter title, or a genre.'
                                : 'Check the spelling or try a different song or artist.'}
                        </p>
                        {empty && discovery.openCatalog && (
                            <ul className="mt-3 flex flex-wrap gap-2">
                                {SUGGESTIONS.map(suggestion => (
                                    <li key={suggestion}><button type="button" onClick={() => selectSuggestion(suggestion)} className={`min-h-11 rounded-full bg-surface-hover px-4 text-sm ${focusRing}`}>{suggestion}</button></li>
                                ))}
                            </ul>
                        )}
                        {failed && (
                            <button type="button" onClick={() => { inputRef.current?.focus(); runSearch(term, true); }} className={`mt-3 min-h-11 rounded-lg bg-surface-hover px-4 text-sm font-medium ${focusRing}`}>
                                Try again
                            </button>
                        )}
                    </div>
                )}

                {current && songDiscovery && (
                    <section aria-labelledby="similar-songs-heading" className="mb-6 max-w-2xl rounded-xl bg-surface px-4 py-5 sm:px-5">
                        <h2 id="similar-songs-heading" className="font-heading font-bold [overflow-wrap:anywhere]">
                            Looking for “{songDiscovery.song.title}” by {songDiscovery.song.author}?
                        </h2>
                        <p role="status" className="mt-1 text-sm text-muted-foreground">
                            We found it on YouTube Music, but couldn’t find a matching track on JioSaavn.{' '}
                            {songDiscovery.loading ? 'Checking similar songs on JioSaavn…'
                                : songDiscovery.alternatives.length ? (songDiscovery.sameArtist
                                    ? 'No similar songs matched. Try these other songs by the artist on JioSaavn.'
                                    : 'Try these similar songs on JioSaavn.')
                                : 'No matching alternatives found.'}
                        </p>
                        {songDiscovery.alternatives.length > 0 && (
                            <div className="mt-3">
                                {songDiscovery.alternatives.map((song, index) => (
                                    <SongRow key={song.id} song={song} index={index} onPlay={() => void setQueue(songDiscovery.alternatives, index)} />
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {(!term || empty) && discovery.tracks.length > 0 && (
                    <section aria-labelledby="discovery-heading" className="mt-6 max-w-2xl border-t border-border pt-4">
                        <h2 id="discovery-heading" className="mb-2 font-heading text-base font-bold">{empty ? 'Play something else' : 'Start listening'}</h2>
                        {discovery.tracks.map((song, index) => (
                            <SongRow key={song.id} song={song} index={index} onPlay={() => void setQueue(discovery.tracks, index)} />
                        ))}
                    </section>
                )}

                {songs.length > 0 && (
                    <section aria-labelledby="search-results-heading">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                            <h2 id="search-results-heading" className="font-heading text-base font-bold">
                                {resultsLabel}
                            </h2>
                            <div role="group" aria-label="Results layout" className="flex gap-1 rounded-lg bg-surface p-1">
                                {(['list', 'grid'] as const).map(mode => (
                                    <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}
                                        className={`min-h-9 rounded-md px-3 text-sm font-medium ${focusRing} ${viewMode === mode ? 'bg-surface-hover text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                                        {mode === 'list' ? 'List' : 'Grid'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {viewMode === 'list' ? (
                            <div className="space-y-0.5">
                                {songs.map((song, i) => (
                                    <SongRow key={`${song.id}-${i}`} song={song} index={i} showIndex onPlay={() => handlePlayFromResults(i)} />
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-2 sm:gap-3">
                                {songs.map((song, i) => (
                                    <SongCard key={`${song.id}-${i}`} song={song} index={i} onPlay={() => handlePlayFromResults(i)} />
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}
