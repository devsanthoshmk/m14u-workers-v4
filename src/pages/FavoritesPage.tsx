/**
 * FavoritesPage — Client-side favorites library.
 * All data from LocalStorage — designed to be portable to a DB later.
 */

import { usePlayerStore } from '@/stores/playerStore';
import { SongRow } from '@/components/song/SongRow';
import { Heart, Play, Shuffle } from 'lucide-react';
import type { TrackItem } from '@/types/music';
import { matchesCatalog, useCatalogStore } from '@/stores/catalogStore';

export function FavoritesPage() {
    const library = usePlayerStore(s => s.favorites);
    const provider = useCatalogStore(s => s.provider);
    const favorites = library.filter(({ song }) => matchesCatalog(provider, song.id));
    const setQueue = usePlayerStore(s => s.setQueue);

    const songs = favorites.map(f => f.song as TrackItem);

    const playAll = (startIndex = 0) => {
        if (songs.length === 0) return;
        setQueue(songs, startIndex);
    };

    const shufflePlay = () => {
        if (songs.length === 0) return;
        void setQueue(songs, 0, true);
    };

    return (
        <div className="mx-auto w-full min-w-0 max-w-4xl px-3 pb-8 sm:px-6">
            {/* Header */}
            <header className="border-b border-border py-5 sm:py-6">
                <div className="flex items-center gap-3 sm:gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 sm:size-16">
                        <Heart className="size-6 text-primary sm:size-8" aria-hidden="true" />
                    </div>
                    <div>
                        <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Favorites</h1>
                        <p className="text-sm text-muted-foreground">
                            {favorites.length} {favorites.length === 1 ? 'track' : 'tracks'}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                {favorites.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                            onClick={() => playAll(0)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            <Play className="size-4" fill="currentColor" aria-hidden="true" />
                            Play all
                        </button>
                        <button
                            onClick={shufflePlay}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            <Shuffle className="size-4" aria-hidden="true" />
                            Shuffle
                        </button>
                    </div>
                )}
            </header>

            {/* Songs list */}
            <div className="pt-4">
                {favorites.length === 0 ? (
                    <div className="rounded-xl bg-surface p-4 sm:p-5">
                        <h2 className="font-heading text-sm font-semibold text-foreground">No favorites yet</h2>
                        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                            Select the heart on a song to save it here.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {songs.map((song, i) => (
                            <SongRow
                                key={`fav-${song.videoId || song.id}-${i}`}
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
