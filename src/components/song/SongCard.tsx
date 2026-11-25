/**
 * SongCard — Grid card for displaying songs.
 *
 * Reference-matched: Large rounded album art, centered play button on hover,
 * duration badge top-right, title + artist below, "now playing" indicator.
 */

import { usePlayerStore } from '@/stores/playerStore';
import { toTrackItem } from '@/utils/trackMetadata';
import { Play, Pause, MoreHorizontal, ListPlus, ListEnd, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';
import type { Song, TrackItem } from '@/types/music';
import { TrackArtwork } from './TrackArtwork';
import { compactTrackArtworkUrls, trackArtworkUrls } from '@/utils/trackArtwork';

interface SongCardProps {
    song: TrackItem | Song;
    index: number;
    highQualityArtwork?: boolean;
    onPlay?: () => void;
}

export function SongCard({ song, onPlay, highQualityArtwork }: SongCardProps) {
    const track = toTrackItem(song);
    const songId = track.id;
    const songTitle = track.name || track.title;
    const songArtist = track.artist?.name || track.author;
    const songDuration = track.duration;
    
    const currentSong = usePlayerStore(s => s.currentSong);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const isBuffering = usePlayerStore(s => s.isBuffering);
    const playSong = usePlayerStore(s => s.playSong);
    const togglePlay = usePlayerStore(s => s.togglePlay);
    const addToQueue = usePlayerStore(s => s.addToQueue);
    const addNext = usePlayerStore(s => s.addNext);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const isFavorite = usePlayerStore(s => songId ? s.isFavorite(songId) : false);

    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const currentSongId = currentSong?.id;
    const isCurrentSong = currentSongId === songId;
    const artworkUrls = highQualityArtwork ? trackArtworkUrls(track) : compactTrackArtworkUrls(track, 300);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        if (showMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showMenu]);

    const handlePlay = () => {
        if (isCurrentSong) {
            if (!isBuffering) void togglePlay();
        } else if (onPlay) {
            onPlay();
        } else {
            playSong(track);
        }
    };

    return (
        <div className="group relative flex flex-col p-2 rounded-xl transition-colors hover:bg-white/[0.04]">
            {/* Album art container */}
            <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-surface">
                <TrackArtwork seed={songId || songTitle} sources={artworkUrls} className="size-full object-cover" lazy />

                {/* License or language badge */}
                {track.licenseLabel ? (
                    <span
                        className="absolute bottom-2 left-2 max-w-[calc(100%-2.5rem)] truncate rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 backdrop-blur-sm"
                        title={track.licenseLabel}
                    >
                        {track.licenseLabel}
                    </span>
                ) : track.language ? (
                    <span
                        className="absolute bottom-2 left-2 max-w-[calc(100%-2.5rem)] truncate rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm capitalize"
                    >
                        {track.language}
                    </span>
                ) : null}

                {/* Duration badge */}
                {!!songDuration && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/70 text-white/90 backdrop-blur-sm">
                        {songDuration}
                    </span>
                )}

                {/* Now playing indicator */}
                {isCurrentSong && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/90 text-[10px] font-semibold text-primary-foreground">
                        <NowPlayingBars isPlaying={isPlaying} />
                    </div>
                )}

                {/* Hover overlay with centered play button */}
                <button
                    type="button"
                    onClick={handlePlay}
                    aria-label={`${isCurrentSong && isPlaying ? 'Pause' : 'Play'} ${songTitle}`}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
                >
                    <span className="flex items-center justify-center h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30">
                        {isCurrentSong && isPlaying ? (
                            <Pause className="h-5 w-5" fill="currentColor" />
                        ) : (
                            <Play className="h-5 w-5 ml-0.5" fill="currentColor" />
                        )}
                    </span>
                </button>

                {/* Context menu button */}
                <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                    className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                >
                    <MoreHorizontal className="h-4 w-4" />
                </button>

                {/* Context menu */}
                {showMenu && (
                    <div
                        ref={menuRef}
                        className="absolute bottom-10 right-2 w-44 rounded-xl bg-popover border border-border shadow-2xl py-1 z-50 animate-fade-in"
                    >
                        <button
                            onClick={() => { addNext(track); setShowMenu(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-white/[0.06] transition-colors"
                        >
                            <ListPlus className="h-4 w-4 text-muted-foreground" />
                            Play next
                        </button>
                        <button
                            onClick={() => { addToQueue(track); setShowMenu(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-white/[0.06] transition-colors"
                        >
                            <ListEnd className="h-4 w-4 text-muted-foreground" />
                            Add to queue
                        </button>
                        <button
                            onClick={() => { toggleFavorite(track); setShowMenu(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-white/[0.06] transition-colors"
                        >
                            <Heart className={cn('h-4 w-4', isFavorite ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                            {isFavorite ? 'Unfavorite' : 'Favorite'}
                        </button>
                    </div>
                )}
            </div>

            {/* Text info */}
            <p className="text-[13px] font-semibold text-foreground line-clamp-1 px-0.5">
                {songTitle}
            </p>
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 px-0.5">
                {songArtist}
            </p>
        </div>
    );
}

/** Animated now-playing bars */
function NowPlayingBars({ isPlaying }: { isPlaying: boolean }) {
    return (
        <div className="flex items-end gap-[2px] h-3">
            {[0, 1, 2].map(i => (
                <div
                    key={i}
                    className={cn(
                        'w-[3px] rounded-full bg-primary-foreground transition-all',
                        isPlaying ? 'animate-now-playing' : 'h-1'
                    )}
                    style={{
                        animationDelay: `${i * 0.15}s`,
                        height: isPlaying ? undefined : '4px',
                    }}
                />
            ))}
        </div>
    );
}
