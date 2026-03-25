/**
 * FavoritesPage — Client-side favorites library.
 * All data from LocalStorage — designed to be portable to a DB later.
 */

import { usePlayerStore } from '@/stores/playerStore';
import { SongRow } from '@/components/song/SongRow';
import { Heart, Play, Shuffle } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TrackItem } from '@/types/music';

export function FavoritesPage() {
    const favorites = usePlayerStore(s => s.favorites);
    const setQueue = usePlayerStore(s => s.setQueue);
    const toggleShuffle = usePlayerStore(s => s.toggleShuffle);

    const songs = favorites.map(f => f.song as TrackItem);

    const playAll = (startIndex = 0) => {
        if (songs.length === 0) return;
        setQueue(songs, startIndex);
    };

    const shufflePlay = () => {
        if (songs.length === 0) return;
        setQueue(songs, 0).then(() => {
            toggleShuffle();
        });
    };

    return (
        <div className="pb-8">
            {/* Header */}
            <div className="px-4 md:px-8 py-6">
                <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 md:h-20 md:w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10">
                        <Heart className="h-8 w-8 md:h-10 md:w-10 text-primary fill-primary/50" />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold font-heading">Favorites</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            {favorites.length} {favorites.length === 1 ? 'song' : 'songs'}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                {favorites.length > 0 && (
                    <div className="flex items-center gap-3 mt-4">
                        <button
                            onClick={() => playAll(0)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:scale-[0.97] transition-all"
                        >
                            <Play className="h-4 w-4" fill="currentColor" />
                            Play all
                        </button>
                        <button
                            onClick={shufflePlay}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-surface hover:bg-surface-hover text-foreground font-medium transition-all"
                        >
                            <Shuffle className="h-4 w-4" />
                            Shuffle
                        </button>
                    </div>
                )}
            </div>

            {/* Songs list */}
            <div className="px-4 md:px-8">
                {favorites.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center py-20 text-center"
                    >
                        <Heart className="h-12 w-12 text-muted-foreground/30 mb-4" />
                        <p className="text-base font-medium text-foreground">No favorites yet</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                            Tap the heart icon on any song to add it to your favorites
                        </p>
                    </motion.div>
                ) : (
                    <div className="space-y-0.5">
                        {songs.map((song, i) => (
                            <SongRow
                                key={`fav-${(song as any).videoId || song.id}-${i}`}
                                song={song}
                                index={i}
                                showIndex
                                onPlay={() => playAll(i)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
