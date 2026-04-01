/**
 * SongCard — Grid card for displaying songs.
 *
 * Reference-matched: Large rounded album art, centered play button on hover,
 * duration badge top-right, title + artist below, "now playing" indicator.
 */

import { usePlayerStore } from '@/stores/playerStore';
import { getThumbnail, formatDuration } from '@/utils/format';
import { Play, Pause, MoreHorizontal, ListPlus, ListEnd, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Song, TrackItem } from '@/types/music';

interface SongCardProps {
    song: TrackItem | Song;
    index: number;
}

export function SongCard({ song }: SongCardProps) {
    // Support both TrackItem and legacy Song - use any casting
    const s = song as any;
    const songId = s.videoId || s.id;
    const songTitle = s.name || s.title;
    const songArtist = s.artist?.name || s.author;
    const songThumbnails = s.thumbnails;
    const songImg = s.img;
    const songDuration = s.duration;
    
    const currentSong = usePlayerStore(s => s.currentSong);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const playSong = usePlayerStore(s => s.playSong);
    const togglePlay = usePlayerStore(s => s.togglePlay);
    const addToQueue = usePlayerStore(s => s.addToQueue);
    const addNext = usePlayerStore(s => s.addNext);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const isFavorite = usePlayerStore(s => songId ? s.isFavorite(songId) : false);

    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didLongPress = useRef(false);

    const handleTouchStart = useCallback(() => {
        didLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            setShowMenu(true);
            window.getSelection()?.removeAllRanges();
        }, 500);
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
        if (didLongPress.current) {
            e.preventDefault();
            didLongPress.current = false;
        }
    }, []);

    const handleTouchMove = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const currentSongId = (currentSong as any)?.videoId || currentSong?.id;
    const isCurrentSong = currentSongId === songId;
    const thumbnail = songImg || (songThumbnails ? getThumbnail(songThumbnails, 300) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        if (showMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [showMenu]);

    const handlePlay = () => {
        if (isCurrentSong) {
            togglePlay();
        } else {
            playSong(song as TrackItem);
        }
    };

    return (
        <div
            className="group relative flex flex-col p-2 rounded-xl transition-colors hover:bg-white/[0.04]"
            onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
        >
            {/* Album art container */}
            <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-surface">
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt={songTitle}
                        className="h-full w-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="h-full w-full bg-white/10" />
                )}

                {/* Duration badge */}
                {!!songDuration && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/70 text-white/90 backdrop-blur-sm">
                        {formatDuration(songDuration)}
                    </span>
                )}

                {/* Now playing indicator */}
                {isCurrentSong && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/90 text-[10px] font-semibold text-primary-foreground">
                        <NowPlayingBars isPlaying={isPlaying} />
                    </div>
                )}

                {/* Hover overlay with centered play button */}
                <div className={cn(
                    'absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity duration-200',
                    'opacity-0 group-hover:opacity-100'
                )}>
                    <button
                        onClick={handlePlay}
                        className="flex items-center justify-center h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform"
                    >
                        {isCurrentSong && isPlaying ? (
                            <Pause className="h-5 w-5" fill="currentColor" />
                        ) : (
                            <Play className="h-5 w-5 ml-0.5" fill="currentColor" />
                        )}
                    </button>
                </div>

                {/* Context menu button */}
                <button
                    onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                    className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 text-white/80 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-black/80"
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
                            onClick={() => { addNext(song as TrackItem); setShowMenu(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-white/[0.06] transition-colors"
                        >
                            <ListPlus className="h-4 w-4 text-muted-foreground" />
                            Play next
                        </button>
                        <button
                            onClick={() => { addToQueue(song as TrackItem); setShowMenu(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-white/[0.06] transition-colors"
                        >
                            <ListEnd className="h-4 w-4 text-muted-foreground" />
                            Add to queue
                        </button>
                        <button
                            onClick={() => { toggleFavorite(song as TrackItem); setShowMenu(false); }}
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
