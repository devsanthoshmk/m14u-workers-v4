/**
 * SearchPage — Full-text search with debounced input and results.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, X, Clock, TrendingUp, Loader2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { useSearchStore } from '@/lib/stores/search';
import { SongRow } from '@/components/song/SongRow';
import { SongCard } from '@/components/song/SongCard';
import { DEBOUNCE } from '@/utils/constants';
import { useDebounce } from '@/hooks/useDebounce';
import { motion } from 'framer-motion';
import type { TrackItem } from '@/types/music';

const SUGGESTIONS = [
    'Believer', 'Shape of You', 'Blinding Lights', 'Starboy',
    'Anirudh', 'AR Rahman', 'Bohemian Rhapsody', 'Despacito',
];

export function SearchPage() {
    const location = useLocation();
    const [query, setQuery] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

    const debouncedQuery = useDebounce(query, DEBOUNCE.SEARCH);
    const inputRef = useRef<HTMLInputElement>(null);

    const { results, isLoading, search } = useSearchStore();
    const setQueue = usePlayerStore(s => s.setQueue);
    const recentSearches = useUIStore(s => s.recentSearches);
    const addRecentSearch = useUIStore(s => s.addRecentSearch);
    const removeRecentSearch = useUIStore(s => s.removeRecentSearch);
    const clearRecentSearches = useUIStore(s => s.clearRecentSearches);

    // Auto-focus search input when navigating to this page
    useEffect(() => {
        if (location.pathname === '/search') {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [location.pathname]);

    // Search when debounced query changes
    useEffect(() => {
        if (!debouncedQuery.trim()) {
            return;
        }
        search(debouncedQuery);
        addRecentSearch(debouncedQuery.trim());
    }, [debouncedQuery]);

    const handleSuggestionClick = (suggestion: string) => {
        setQuery(suggestion);
        inputRef.current?.focus();
    };

    const handlePlayFromResults = useCallback((index: number) => {
        if (results.length > 0) {
            setQueue(results as TrackItem[], index);
        }
    }, [results, setQueue]);

    const songs = results.filter(r => r.type === 'song' || r.type === 'video') as TrackItem[];

    return (
        <div className="pb-8">
            {/* Search header */}
            <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-white/[0.04] px-4 md:px-8 py-4">
                <div className="relative max-w-2xl">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search songs, artists, albums..."
                        className="w-full h-12 pl-12 pr-12 rounded-xl bg-white/[0.06] text-foreground placeholder:text-muted-foreground text-base outline-none border border-white/[0.08] focus:border-primary/40 focus:ring-2 focus:ring-primary/15 transition-all"
                    />
                    {query && (
                        <button
                            onClick={() => {
                                setQuery('');
                                inputRef.current?.focus();
                            }}
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            <div className="px-4 md:px-8 mt-4">
                {/* Loading */}
                {isLoading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                )}

                {/* Empty state with suggestions and recent searches */}
                {!isLoading && songs.length === 0 && !query && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-8"
                    >
                        {/* Recent searches */}
                        {recentSearches.length > 0 && (
                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-base font-bold font-heading">Recent Searches</h2>
                                    <button
                                        onClick={clearRecentSearches}
                                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Clear all
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {recentSearches.map((search) => (
                                        <div
                                            key={search}
                                            className="group flex items-center gap-2 px-3 py-2 rounded-full bg-surface hover:bg-surface-hover text-sm transition-all cursor-pointer"
                                            onClick={() => handleSuggestionClick(search)}
                                        >
                                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span className="text-foreground">
                                                {search}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeRecentSearch(search);
                                                }}
                                                className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Suggestions */}
                        <section>
                            <h2 className="text-base font-bold font-heading mb-3 flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-primary" />
                                Try searching
                            </h2>
                            <div className="flex flex-wrap gap-2">
                                {SUGGESTIONS.map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        onClick={() => handleSuggestionClick(suggestion)}
                                        className="px-4 py-2 rounded-full bg-surface hover:bg-primary/15 hover:text-primary text-sm text-foreground transition-all"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        </section>
                    </motion.div>
                )}

                {/* Search results */}
                {!isLoading && songs.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-muted-foreground">
                                {songs.length > 0
                                    ? `${songs.length} result${songs.length > 1 ? 's' : ''}`
                                    : 'No results found'
                                }
                            </p>

                            {songs.length > 0 && (
                                <div className="flex items-center gap-1 bg-surface rounded-lg p-0.5">
                                    <button
                                        onClick={() => setViewMode('list')}
                                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-surface-hover text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        List
                                    </button>
                                    <button
                                        onClick={() => setViewMode('grid')}
                                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${viewMode === 'grid' ? 'bg-surface-hover text-foreground' : 'text-muted-foreground'
                                            }`}
                                    >
                                        Grid
                                    </button>
                                </div>
                            )}
                        </div>

                        {songs.length > 0 && viewMode === 'list' && (
                            <div className="space-y-0.5">
                                {songs.map((song, i) => (
                                    <SongRow
                                        key={`${song.id}-${i}`}
                                        song={song}
                                        index={i}
                                        showIndex
                                        onPlay={() => handlePlayFromResults(i)}
                                    />
                                ))}
                            </div>
                        )}

                        {songs.length > 0 && viewMode === 'grid' && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
                                {songs.map((song, i) => (
                                    <SongCard key={`${song.id}-${i}`} song={song} index={i} />
                                ))}
                            </div>
                        )}

                        {songs.length === 0 && query && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <Search className="h-10 w-10 text-muted-foreground mb-3" />
                                <p className="text-sm font-medium text-foreground">No songs found</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Try different keywords or check the spelling
                                </p>
                            </div>
                        )}
                    </motion.div>
                )}
            </div>
        </div>
    );
}
