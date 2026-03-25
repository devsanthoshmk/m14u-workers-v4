/**
 * HomePage — Gallery view with recently played.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { SongCard } from '@/components/song/SongCard';
import { getGreeting } from '@/utils/format';
import { motion } from 'framer-motion';
import type { TrackItem } from '@/types/music';

export function HomePage() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const listeningHistory = usePlayerStore(s => s.listeningHistory);

    const fetchGallery = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            // For now, show empty gallery - user artists can be loaded from localStorage
            // The gallery API requires channel IDs which we'd need to store
            await new Promise(r => setTimeout(r, 100)); // Simulate API call
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load content');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchGallery();
    }, [fetchGallery]);

    const greeting = getGreeting();
    const recentSongs = listeningHistory.slice(0, 8).map(h => h.song as TrackItem);

    return (
        <div className="pb-8">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-white/[0.04]">
                <div className="flex items-center justify-between px-5 md:px-8 py-5">
                    <motion.h1
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-2xl md:text-3xl font-bold font-heading"
                    >
                        {greeting}
                    </motion.h1>
                </div>
            </div>

            <div className="px-3 md:px-6 mt-4 space-y-6">
                {/* Recently Played */}
                {recentSongs.length > 0 && (
                    <section>
                        <h2 className="text-lg font-bold font-heading mb-2 px-2">Recently Played</h2>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-0">
                            {recentSongs.map((song, i) => (
                                <SongCard 
                                    key={`recent-${(song as any).videoId || song.id}-${i}`} 
                                    song={song} 
                                    index={i} 
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* Loading */}
                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Loading...</p>
                    </div>
                )}

                {/* Error */}
                {error && !isLoading && (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                        <AlertCircle className="h-10 w-10 text-destructive" />
                        <div>
                            <p className="text-sm font-medium text-foreground">{error}</p>
                        </div>
                        <button
                            onClick={fetchGallery}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-sm"
                        >
                            <RefreshCw className="h-4 w-4" /> Retry
                        </button>
                    </div>
                )}

                {/* Empty state when not loading */}
                {!isLoading && !error && recentSongs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                        <p className="text-lg font-medium text-foreground">Welcome to M14U</p>
                        <p className="text-sm text-muted-foreground">Search for music to get started</p>
                    </div>
                )}
            </div>
        </div>
    );
}
