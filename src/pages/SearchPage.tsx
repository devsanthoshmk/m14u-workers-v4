/** SearchPage — Debounced music search and playback from results. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, Clock, Loader2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { useSearchStore } from '@/lib/stores/search';
import { SongRow } from '@/components/song/SongRow';
import { SongCard } from '@/components/song/SongCard';
import { DEBOUNCE } from '@/utils/constants';
import type { TrackItem } from '@/types/music';

const SUGGESTIONS = [
    'Believer', 'Shape of You', 'Blinding Lights', 'Starboy',
    'Anirudh', 'AR Rahman', 'Bohemian Rhapsody', 'Despacito',
];

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type SearchResult =
    | { term: string; status: 'pending' | 'error' }
    | { term: string; status: 'done'; songs: TrackItem[] };

export function SearchPage() {
    const [query, setQuery] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [result, setResult] = useState<SearchResult | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsHeadingRef = useRef<HTMLHeadingElement>(null);
    const requestRef = useRef<SearchResult | null>(null);
    const searchChain = useRef(Promise.resolve());
    const term = query.trim();

    const search = useSearchStore(s => s.search);
    const setQueue = usePlayerStore(s => s.setQueue);
    const recentSearches = useUIStore(s => s.recentSearches);
    const addRecentSearch = useUIStore(s => s.addRecentSearch);
    const removeRecentSearch = useUIStore(s => s.removeRecentSearch);
    const clearRecentSearches = useUIStore(s => s.clearRecentSearches);

    const runSearch = useCallback((value: string, retry = false) => {
        if (!value || (requestRef.current?.term === value && !(retry && requestRef.current.status === 'error'))) return;

        const request = { term: value, status: 'pending' } as const;
        requestRef.current = request;
        setResult(request);

        // The store has one shared result slot. Serialize requests so each snapshot
        // belongs to its term, skipping queued work superseded by newer input.
        searchChain.current = searchChain.current.then(async () => {
            if (requestRef.current !== request) return;
            addRecentSearch(value);
            await search(value);
            if (requestRef.current !== request) return;

            const { error, results } = useSearchStore.getState();
            const completed: SearchResult = error
                ? { term: value, status: 'error' }
                : { term: value, status: 'done', songs: results.filter(r => r.type === 'song' || r.type === 'video') as TrackItem[] };
            requestRef.current = completed;
            setResult(completed);
        });
    }, [addRecentSearch, search]);

    useEffect(() => {
        if (!term || isComposing) return;
        const timer = window.setTimeout(() => runSearch(term), DEBOUNCE.SEARCH);
        return () => window.clearTimeout(timer);
    }, [term, isComposing, runSearch]);

    const updateQuery = (value: string) => {
        if (value.trim() !== term) {
            requestRef.current = null;
            setResult(null);
        }
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

    const current = result?.term === term ? result : null;
    const songs = current?.status === 'done' ? current.songs : [];
    const pending = Boolean(term && (!current || current.status === 'pending'));
    const failed = current?.status === 'error';
    const empty = current?.status === 'done' && songs.length === 0;
    const announcement = pending ? 'Searching…'
        : failed ? 'Search couldn’t load.'
        : empty ? `No songs found for “${term}”.`
        : songs.length ? `${songs.length} result${songs.length === 1 ? '' : 's'} for “${term}”.`
        : '';

    const handlePlayFromResults = (index: number) => {
        void setQueue(songs, index);
    };

    return (
        <div
            className="pb-8"
            onKeyDown={(event) => {
                // Keep native Space activation for search controls instead of playing music.
                if (event.code === 'Space' && event.target instanceof HTMLButtonElement) event.stopPropagation();
            }}
        >
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
                            placeholder="Songs, artists, or albums"
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
                                        }}
                                        className={`min-h-10 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground ${focusRing}`}
                                    >
                                        Clear all
                                    </button>
                                </div>
                                <ul className="flex flex-wrap gap-2">
                                    {recentSearches.map((entry) => (
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
                                </ul>
                            </section>
                        )}
                        <section aria-labelledby="suggested-searches-heading">
                            <h2 id="suggested-searches-heading" ref={suggestionsHeadingRef} tabIndex={-1} className="mb-3 w-fit rounded-sm font-heading text-base font-bold focus:outline-primary">
                                Try searching
                            </h2>
                            <ul className="flex flex-wrap gap-2">
                                {SUGGESTIONS.map((suggestion) => (
                                    <li key={suggestion}>
                                        <button type="button" onClick={() => selectSuggestion(suggestion)} className={`min-h-11 rounded-full bg-surface px-4 text-sm hover:bg-surface-hover hover:text-primary ${focusRing}`}>
                                            {suggestion}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>
                )}

                {pending && (
                    <div aria-hidden="true" className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 text-primary motion-safe:animate-spin" />
                        Searching…
                    </div>
                )}

                {(failed || empty) && (
                    <div className="max-w-2xl rounded-xl border border-border bg-surface px-4 py-5 sm:px-5">
                        <h2 className="font-heading font-bold [overflow-wrap:anywhere]">{announcement}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {failed ? 'Check your connection and try again.' : 'Check the spelling or try a different song or artist.'}
                        </p>
                        {failed && (
                            <button type="button" onClick={() => { inputRef.current?.focus(); runSearch(term, true); }} className={`mt-3 min-h-11 rounded-lg bg-surface-hover px-4 text-sm font-medium ${focusRing}`}>
                                Try again
                            </button>
                        )}
                    </div>
                )}

                {songs.length > 0 && (
                    <section aria-labelledby="search-results-heading">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                            <h2 id="search-results-heading" className="font-heading text-base font-bold">
                                {songs.length} {songs.length === 1 ? 'result' : 'results'}
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
